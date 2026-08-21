import io
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from models.database import SessionLocal, EnergyEfficiency
from dotenv import load_dotenv

load_dotenv()

# AI를 쓰는 두 경로 — 화면 요약(agent)과 자유 질의응답(chat) — 는 둘 다
# LangGraph 그래프이고, 그 안의 call_llm 노드가 openrouter_client 를 통해 같은
# 모델을 부른다. 키가 없어도 임포트는 성공하고, 호출 시점에 OpenRouterError 가 난다.
#
# 그럼에도 임포트를 try 로 감싸는 이유는 예전과 같다: Confidence 피드백은
# 결정론적으로 계산되므로 AI 없이도 동작해야 하고, AI 쪽 사정으로 서버 기동
# 자체가 실패하면 안 된다.
try:
    from agent import summary_graph
except Exception as agent_import_error:  # pragma: no cover
    summary_graph = None
    print(f"[warn] AI 요약 비활성화: {agent_import_error}")

from chat import ask_assistant
from openrouter_client import OPENROUTER_MODEL, OpenRouterError

# 외부 공공데이터 연동(기상청 실황·특보, KPX 발전량·설비).
#
# AI 임포트와 같은 이유로 감싼다 — 이 계층이 없어도 시뮬레이터는 지금까지와
# 똑같이 로컬 추정값으로 동작해야 하므로, 임포트 실패가 서버 기동을 막으면 안 된다.
# services/ 안의 함수는 실패 시 예외 대신 None 을 돌려주도록 만들어져 있다.
try:
    from services import kpx_api, weather_api
except Exception as services_import_error:  # pragma: no cover
    kpx_api = None
    weather_api = None
    print(f"[warn] 외부 데이터 연동 비활성화: {services_import_error}")

# 값의 출처 표기. 화면이 "실시간 연동"과 "추정 시뮬레이션값"을 섞어 보여주지
# 않도록 응답마다 이 둘 중 하나를 붙인다 (README 9.3 면책 원칙).
# 확신이 없으면 항상 FALLBACK 이다.
SOURCE_LIVE = "live"
SOURCE_FALLBACK = "fallback"

# 환경변수로 AI 호출을 끌 수 있게 한다 (테스트/오프라인 데모용)
AI_DISABLED = os.getenv("CLIMATELOOP_DISABLE_AI", "").lower() in ("1", "true", "yes")


def ensure_seeded() -> None:
    """서버가 실제로 열 DB 에 계수가 들어 있는지 기동 시점에 확인하고, 비면 채운다.

    배포 빌드 단계에서 시드를 돌리는 것만으로는 부족했다. 시드된
    data/climateloop.db 는 산출물이라 저장소에 없고, SQLite 는 없는 파일을 조용히
    새로 만든다 — 그래서 "기동 성공 + 첫 쿼리에서 no such table" 이라는, 로그만
    봐서는 정상으로 보이는 실패가 난다. 실제로 Railway 에서 /calculate·/regions
    만 500 이고 /chat·/confidence/levels 는 200 이었다.

    빌드 단계에 의존하지 않는 이유가 하나 더 있다. 빌더 종류·레이어 캐시·마운트된
    볼륨에 따라 빌드 때 만든 파일이 런타임에 그 자리에 없을 수 있다. 반면 이
    함수는 **서버가 실제로 열 파일을 직접 보고** 판단하므로 그 변수들에 걸리지
    않는다. 빌드 단계의 시드는 그대로 두었다 — 첫 요청을 기다리게 하지 않고,
    실패하면 빌드 로그에서 바로 보인다.

    비어 있을 때만 채운다. 매 기동마다 다시 적재하지 않으므로 볼륨을 붙여
    DB 를 보존하는 구성에서도 하는 일이 없다.

    실패해도 기동은 막지 않는다. 이 모듈의 다른 임포트를 try 로 감싸는 것과 같은
    이유다 — AI·외부 데이터 없이도 돌아가야 하는 것처럼, 계수를 못 채웠다고
    /chat·/confidence/levels 까지 죽일 이유가 없다.
    """
    from models.database import DB_PATH as SERVER_DB_PATH, init_db

    try:
        from scripts.seed_db import (
            DB_PATH as SEED_DB_PATH,
            describe_database,
            seed_data,
        )
    except Exception as exc:  # pragma: no cover
        print(f"[db:boot] 시드 모듈을 불러오지 못했습니다: {exc!r}")
        print(f"[db:boot] 서버가 열 DB = {SERVER_DB_PATH}")
        return

    # 시드와 서버가 같은 파일을 보는지 먼저 확인한다. 예전 코드는 둘 다 CWD 기준
    # 상대경로였고 기준 디렉터리가 서로 달라, 시드가 성공해도 서버는 빈 DB 를 봤다.
    # 두 경로는 이제 각 모듈의 파일 위치에서 유도되므로 어긋날 수 없지만, 어긋나면
    # 증상이 다시 "원인 모를 500" 이 되므로 로그에 남긴다.
    if os.path.realpath(SEED_DB_PATH) != os.path.realpath(SERVER_DB_PATH):
        print("[db:boot] 경로 불일치! 시드와 서버가 서로 다른 파일을 가리킵니다.")
        print(f"[db:boot]   seed   -> {SEED_DB_PATH}")
        print(f"[db:boot]   server -> {SERVER_DB_PATH}")

    # 파일·테이블이 없으면 만든다. 이미 있으면 아무 일도 하지 않는다.
    init_db()
    state = describe_database("boot")

    if state["rows"]:
        return

    # 테이블은 있는데 행이 없다 = 빌드 단계의 시드가 돌지 않았거나 다른 파일에 썼다.
    print("[db:boot] 지역 계수가 비어 있습니다. 시드를 지금 실행합니다.")
    try:
        seed_data()
    except Exception as exc:  # pragma: no cover
        print(f"[db:boot] 시드 실패: {exc!r}")
        # 테이블은 있고 행만 없는 상태다. 두 엔드포인트가 서로 다르게 떨어진다:
        # /calculate 는 load_efficiency_map 의 폴백으로 모든 계수가 1.0 이 되고
        # (지역 차이가 사라진 채 200), /regions 는 load_all_efficiency_maps 가
        # 빈 dict 를 돌려주므로 regions: [] 로 200 이 된다(지도 마커가 없다).
        print("[db:boot] /calculate 는 모든 지역 계수 1.0 으로, /regions 는 빈 "
              "목록으로 응답합니다. 나머지 엔드포인트는 영향받지 않습니다.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 요청을 받기 전에 끝난다. 여기서 확인해 두지 않으면 첫 요청이 500 이 된다.
    ensure_seeded()
    yield


app = FastAPI(title="ClimateLoop API", lifespan=lifespan)

# CORS
# 기존 설정은 allow_origins=["*"] + allow_credentials=True 였는데, 이 조합은 CORS 명세상
# 무효라 브라우저가 인증정보 요청을 거부한다. 이 API는 쿠키·인증을 쓰지 않으므로
# credentials 를 끄고, 오리진은 로컬 개발 주소로 좁힌다.
#
# 프론트를 다른 포트·도메인에서 띄우면 CLIMATELOOP_ALLOWED_ORIGINS 로 지정한다.
#   예: CLIMATELOOP_ALLOWED_ORIGINS=http://localhost:3005
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:3001,http://127.0.0.1:3001"
)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CLIMATELOOP_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
    if origin.strip()
]

# 목록으로 잡을 수 없는 오리진을 위한 통로.
#
# Vercel 은 커밋마다 프리뷰 도메인을 새로 만든다
# (climateloop-git-<브랜치>-<팀>.vercel.app). 프로덕션 도메인만 위 목록에 넣으면
# 프리뷰 배포는 전부 CORS 로 막히고, 화면에는 원인을 알 수 없는
# "TypeError: Failed to fetch" 만 뜬다.
#
# 미지정 시 None 이라 기본 동작은 지금까지와 같다. 지정할 때는 도메인 끝을
# 반드시 고정하라 — climateloop.*\.vercel\.app 처럼 열어 두면 남의 프로젝트
# 도메인도 통과한다.
#   예: CLIMATELOOP_ALLOWED_ORIGIN_REGEX=https://climateloop-[a-z0-9-]+\.vercel\.app
ALLOWED_ORIGIN_REGEX = os.getenv("CLIMATELOOP_ALLOWED_ORIGIN_REGEX") or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# DB Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class EnergyMix(BaseModel):
    renewable: float
    nuclear: float
    fossil: float
    region: str = "서울"
    weather_scenario: str = "맑음"  # 맑음, 흐림/비, 태풍, 겨울
    include_ai: bool = True  # False면 LLM 호출을 건너뛴다 (테스트/빠른 미리보기용)
    # 화면에 이미 표시 중인 AI 해설을 그대로 넘기면 같은 문장을 다시 생성하지 않고
    # 재사용한다 (12초 -> 0.1초). 서버측 PDF 엔드포인트(/generate-pdf)가 쓰던 통로였고
    # 그 엔드포인트는 제거됐지만(리포트는 브라우저에서 jsPDF 로 만든다) 필드는 남긴다 —
    # 해설을 재생성하지 않고 같은 계산을 다시 받고 싶은 호출부에 그대로 쓸 수 있다.
    ai_message: str | None = None


class RegionQuery(BaseModel):
    """/regions 입력. 전 지역을 한꺼번에 계산하므로 region 필드가 없다.

    EnergyMix 를 재사용하지 않는 이유: include_ai / ai_message / region 은
    이 엔드포인트에서 의미가 없어, 받아놓고 무시하면 호출자가 그 값이
    반영된다고 오해한다.
    """
    renewable: float
    nuclear: float
    fossil: float
    weather_scenario: str = "맑음"


class ChatMixContext(BaseModel):
    """대화 컨텍스트로 넘어온 에너지 믹스. 화면이 쓰고 있는 값 그대로다."""
    renewable: float = 0.0
    nuclear: float = 0.0
    fossil: float = 0.0


class ChatFactorContext(BaseModel):
    """감점 요인 한 줄. /calculate 가 내려준 factors 를 그대로 되돌려 받는다."""
    label: str = ""
    penalty: float = 0.0
    detail: str = ""


class ChatContext(BaseModel):
    """질문 시점에 화면에 떠 있던 상태.

    프론트가 이미 가진 값을 그대로 돌려보낸다. 서버가 다시 계산하지 않는 이유는
    화면의 숫자와 답변의 숫자를 반드시 같게 하기 위해서다 — 여기서 재계산하면
    디바운스 구간에서 사용자가 보고 있는 값과 어긋난 답이 나올 수 있다.

    모든 필드에 기본값이 있다. 결과가 아직 없는 초기 상태에서도 질문은 할 수
    있어야 하고, 그때는 "아직 계산 전"인 채로 답하면 된다.
    """
    region: str = ""
    weather: str = ""
    mix: ChatMixContext = ChatMixContext()
    score: float | None = None
    carbon: float | None = None
    grid_status: str | None = None
    best_source: str | None = None
    factors: list[ChatFactorContext] = []
    # 화면에 표시 중인 즉시 요약/AI 해설. 챗 첫 말풍선과 같은 문장이라
    # "방금 말한 그거"라는 되물음을 모델이 알아들을 수 있게 한다.
    summary: str | None = None


class ChatTurn(BaseModel):
    role: str  # "user" | "assistant" — 그 외 값은 chat.py 가 버린다
    content: str = ""


class ChatRequest(BaseModel):
    message: str
    context: ChatContext = ChatContext()
    # 이전 대화. 없으면 매 질문이 첫 질문처럼 취급된다.
    history: list[ChatTurn] = []


WEATHER_PROFILES = {
    "맑음": {"solar_mult": 1.2, "wind_mult": 1.0, "demand_mult": 1.0, "msg": "태양광 발전 최적 조건입니다."},
    "흐림/비": {"solar_mult": 0.2, "wind_mult": 0.8, "demand_mult": 1.1, "msg": "비로 인해 태양광 발전량이 급감했습니다."},
    "태풍": {"solar_mult": 0.1, "wind_mult": 0.0, "demand_mult": 1.2, "msg": "강풍으로 인해 안전을 위해 풍력 발전기가 정지되었습니다."},
    "겨울": {"solar_mult": 0.7, "wind_mult": 1.3, "demand_mult": 1.5, "msg": "난방 수요가 급증하고 일조 시간이 짧아졌습니다."}
}

# ---------------------------------------------------------------------------
# Confidence(자신감) 설계용 상수
#
# ARCS의 C는 (1) 목표 명시 (2) 단계적 성공 경험 (3) 통제감·귀인 으로 나뉜다.
# 세 요소 모두 아래 상수와 순수 함수로 결정론적으로 계산한다.
# LLM은 이 결과를 "해설"만 하며, 수치를 생성하지 않는다.
# (README 13절: 임의 추정치를 사실처럼 표기하지 않음)
# ---------------------------------------------------------------------------

MIX_KEYS = ("renewable", "nuclear", "fossil")

MIX_LABELS = {"renewable": "재생에너지", "nuclear": "원자력", "fossil": "화석연료"}

# ---------------------------------------------------------------------------
# 발전원별 배출계수 (gCO2/kWh) — 시뮬레이션용 예시 계수
#
# [중요] 아래 수치는 특정 기관이 발표한 공식 배출계수가 아니다.
#        교육용 시뮬레이터에서 "화력을 줄이면 배출이 줄어든다"는 관계를
#        체감시키기 위한 상대 비교용 예시값이며, 출처를 확인하지 못했다.
#
# 따라서 화면·리포트에서도 절대 수치가 아니라 상대 변화로 읽히도록 표기한다.
# 실제 정책 판단이나 대외 인용에 쓰려면 온실가스종합정보센터(GIR)나
# EG-TIPS가 공표한 발전원별 배출계수로 교체해야 한다. 교체 시 이 딕셔너리
# 하나만 바꾸면 계산·점수·차트·리포트에 일괄 반영된다.
#
# 값의 성격:
#   renewable / nuclear — 발전 단계에서 연료를 태우지 않는 무탄소 전원.
#                         설비 제조·건설을 포함한 전 주기 관점의 낮은 값을 가정.
#   fossil              — 석탄·가스 등을 묶은 화력 평균을 가정.
# ---------------------------------------------------------------------------
EMISSION_FACTORS = {
    "renewable": 12.0,
    "nuclear": 12.0,
    "fossil": 650.0,
}

# 계수에서 파생되는 이론적 최선/최악 (점수 환산 기준)
CARBON_BEST = min(EMISSION_FACTORS.values())    # 무탄소 100%
CARBON_WORST = max(EMISSION_FACTORS.values())   # 화력 100%

# 화면·리포트에 공통으로 붙이는 한 줄 면책 문구
EMISSION_FACTOR_NOTE = (
    "배출계수는 상대 비교를 위한 시뮬레이션용 예시값입니다. "
    "공식 통계 수치가 아닙니다."
)

# ---------------------------------------------------------------------------
# 발전원별 기준 발전 규모 (MWh) — 추정 발전량 산출용 스케일 상수
#
# [중요] 아래 수치는 통계도, 실제 설비용량도 아니다. 지역별 설비용량(capacity)
#        데이터가 없는 상태에서 "지역 계수 × 기상 배수 × 믹스 비중"이라는
#        무차원 곱에 크기를 부여하기 위해 임의로 정한 기준값이다.
#        개별 값의 출처는 없다.
#
# 정한 방식: 100~500 MWh 범위에서, 화력이 가장 큰 기저 전원이고 수력이 가장
#            작다는 순서만 반영했다. 순서 외에는 어떤 것도 주장하지 않는다.
#            배출계수(gCO2/kWh)를 그대로 쓰지 않은 이유는 단위가 다르기
#            때문이다 — 발전량에 배출계수를 곱하면 배출량이 되지 발전량이
#            되지 않는다.
#
# 정식 활용 전 필요 조치: 한국전력거래소(KPX)의 지역·발전원별 설비용량으로
#            교체하고, 이때 estimate_generation()의 스케일 상수 자리에 그대로
#            들어가면 된다. 교체하면 지도 마커 크기·오버레이 차트에 일괄 반영된다.
# ---------------------------------------------------------------------------
GENERATION_SCALE = {
    "태양광": 120.0,
    "풍력": 150.0,
    "수력": 100.0,
    "화력": 500.0,
}

GENERATION_UNIT = "MWh (추정)"

GENERATION_NOTE = (
    "실제 발전량 통계가 아닌 시뮬레이션 추정값입니다. "
    "지역별 설비용량 데이터가 없어 '지역 효율계수 × 기상 배수 × 에너지 믹스 비중 × "
    "기준 발전 규모(GENERATION_SCALE)'로 산출한 값이며, 지역 간 상대 비교 용도로만 씁니다."
)

# KPX 실시간 발전원 구성비를 반영했을 때의 note.
#
# 기존 문구를 지우지 않고 따로 두는 이유: 두 경우에 참인 내용이 다르다. 실데이터가
# 붙어도 **지역별 배분은 여전히 추정**이므로(KPX 발전량 현황은 전국 단위다),
# "이제 전부 실측"이라고 말하면 그게 새로운 과장이 된다. 무엇이 실데이터로
# 바뀌었고 무엇이 그대로인지를 한 문장에 함께 적는다.
GENERATION_NOTE_LIVE = (
    "발전원 간 구성비는 한국전력거래소(KPX) 발전원별 발전량 현황을 반영했습니다. "
    "다만 지역별 배분은 여전히 '지역 효율계수 × 기상 배수 × 에너지 믹스 비중'으로 "
    "계산한 추정 시뮬레이션값이며, MWh 절대 크기도 추정 기준값입니다 "
    "(발전량 현황의 단위는 GW로, 에너지량으로 환산할 이용률 데이터가 없습니다)."
)

# kpx_api 는 순환 임포트를 피해 총합만 상수로 들고 있다. 두 값이 어긋나면 실데이터
# 적용 순간 지도 마커 크기가 통째로 달라지므로, 기동 시점에 한 번 맞춰 본다.
# 조용히 어긋나는 것보다 로그로 드러나는 편이 낫다.
if kpx_api is not None:
    _scale_total = sum(GENERATION_SCALE.values())
    if abs(_scale_total - kpx_api.SCALE_TOTAL) > 0.5:
        print(
            f"[warn] GENERATION_SCALE 합계({_scale_total})와 "
            f"kpx_api.SCALE_TOTAL({kpx_api.SCALE_TOTAL})이 다릅니다. "
            "KPX 실데이터를 적용하면 지도 마커 크기가 달라집니다."
        )

# ---------------------------------------------------------------------------
# 지역 효율계수의 출처 (seed_db.py 가 남긴 기록)
#
# 68개 지역 계수는 DB(energy_efficiency)에서 읽는데, 그 값이 KPX 설비용량에서
# 유도된 것인지 하드코딩 표에서 온 것인지는 값만 봐서 알 수 없다. seed 시점에
# 옆에 적어 둔 기록을 읽어 /calculate 응답의 data_source 로 그대로 내보낸다.
#
# 파일로 두는 이유: DB 스키마를 건드리지 않는다. 계수의 출처는 계산에 쓰이는
# 값이 아니라 그 값에 대한 설명이므로, 테이블에 컬럼을 더할 만한 것이 아니다.
#
# 이 값은 **요청 시점의 실시간 여부가 아니라 seed 시점의 출처**다. 그래서 화면의
# 각주 교체(섹션 1)는 이것이 아니라 /regions 의 data_source 를 본다 — 그쪽이
# 요청 시점에 실제로 KPX 를 불러 본 결과다.
# ---------------------------------------------------------------------------
COEFFICIENT_SOURCE_PATH = os.path.join(os.path.dirname(__file__), "data", "coefficient_source.json")


# 발전원별 출처가 갈릴 수 있으므로 기본값을 명시해 둔다. 기록이 없으면 넷 다 내장 표다.
BUILTIN_COVERED_SOURCES = {"solar": "builtin", "wind": "builtin",
                           "hydro": "builtin", "thermal": "builtin"}

# 실측으로 볼 출처 이름.
#   "kpx"      KPX 실시간 API (현재 이 경로로는 시·도 계수를 만들 수 없다)
#   "kpx_file" EPSIS 지역별 발전설비 설비용량 스냅샷 — 화력
#   "kea_file" 한국에너지공단 신·재생 보급용량 스냅샷 — 태양광·풍력·수력
#
# [용어 주의] 이 판정이 만드는 data_source 의 "live" 는 **실측 출처**라는 뜻이고
# "실시간 조회"가 아니다. 계수는 seed 시점에 파일에서 읽어 DB 에 굳는다.
# 같은 문자열이 /regions 응답에서는 "요청 시점에 KPX 를 실제로 불렀다"를 뜻하므로
# 두 자리의 "live" 는 가리키는 것이 다르다 — 화면 문구를 쓸 때 섞지 않는다.
LIVE_COEFFICIENT_ORIGINS = ("kpx", "kpx_file", "kea_file")


def read_coefficient_source() -> dict:
    """seed 시점 기록을 읽는다. 파일이 없거나 깨져 있으면 fallback 으로 본다.

    covered_sources 를 함께 내보내는 이유: 계수 68개의 출처가 발전원별로 갈릴 수
    있다. 화력만 EPSIS 설비용량이고 나머지 셋은 내장 표인 지금 상태가 그렇다.
    data_source 하나로는 그 상태를 말할 수 없어서, 화면이 발전원별로 다른 각주를
    쓰려면 이 표가 필요하다.

    data_source 는 "하나라도 실측이면 live" 가 아니다 — 넷 다 실측일 때만 live 다.
    섞인 상태에서 live 라고 말하면 아직 내장 표인 열의 각주가 실측을 주장하게 된다.
    네 열이 모두 공표 설비용량에서 오게 된 지금은 live 이고, 그중 하나라도
    파일이 없어 내장 표로 떨어지면 자동으로 fallback 으로 되돌아간다.

    화면의 발전원별 각주는 이 단일 값이 아니라 covered_sources 를 본다. data_source
    는 "넷 다 실측인가"라는 한 가지 질문에만 답한다.
    """
    try:
        with io.open(COEFFICIENT_SOURCE_PATH, encoding="utf-8") as handle:
            record = json.load(handle)
    except (OSError, ValueError):
        return {"data_source": SOURCE_FALLBACK, "origin": "builtin",
                "covered_sources": dict(BUILTIN_COVERED_SOURCES)}

    origin = record.get("origin")
    covered = dict(BUILTIN_COVERED_SOURCES)
    recorded = record.get("covered_sources")
    if isinstance(recorded, dict):
        # 기록에 있는 발전원만 덮어쓴다. 모르는 키는 무시하고, 빠진 키는 builtin 이다.
        for key in covered:
            value = recorded.get(key)
            if isinstance(value, str) and value:
                covered[key] = value

    all_live = all(value in LIVE_COEFFICIENT_ORIGINS for value in covered.values())
    return {
        "data_source": SOURCE_LIVE if all_live else SOURCE_FALLBACK,
        "origin": origin or "builtin",
        "covered_sources": covered,
        "seeded_at": record.get("seeded_at"),
        "note": record.get("note"),
    }

# 지속가능성 지수를 구성하는 요인과 가중치 (합 = 1.0)
FACTOR_WEIGHTS = {"carbon": 0.55, "grid": 0.30, "fit": 0.15}

# 목표 점수. 프론트엔드 SUSTAINABILITY_THRESHOLD(page.tsx:44)와 일치시킨다.
GOAL_TARGET = 70.0

# 단계적 성공 경험을 위한 4단계
PROGRESS_LEVELS = [
    {"id": 1, "name": "탄소 의존", "min_score": 0.0},
    {"id": 2, "name": "전환 시작", "min_score": 40.0},
    {"id": 3, "name": "저탄소 진입", "min_score": 70.0},
    {"id": 4, "name": "기후 안정", "min_score": 85.0},
]

# 전력 공급이 수요를 이만큼 초과하면 출력제한(curtailment) 구간으로 본다
SURPLUS_MARGIN = 30.0

# "다음 행동" 탐색 시 시도할 조정폭(%p)
NEXT_ACTION_DELTAS = (10.0, 5.0, -5.0, -10.0)

# 이 점수 이상 개선되는 후보만 제안한다
MIN_IMPROVEMENT = 0.5

# 전력망 상태의 우열. 값이 클수록 좋다.
# surplus(과잉/출력제한)는 정전보다는 낫지만 stable보다는 못한 상태로 본다.
GRID_RANK = {"deficit": 0, "surplus": 1, "stable": 2}

# 전력망 등급을 회복시키는 후보에 주는 우선순위 가산점.
# 점수 상승량과 같은 단위(점)로 더하므로, 상승폭이 훨씬 큰 후보는 여전히 이길 수 있다.
GRID_RECOVERY_BONUS = 5.0

# 공급 여유 비교 시 부동소수 오차 허용치
MARGIN_EPS = 0.01

# 재생에너지 잠재력 정규화 기준 (전남 태양광 1.55 × 맑음 1.2 수준을 상한으로 본다)
POTENTIAL_SCALE = 1.5

# 수력 적합도의 기준 지수.
#
# 수력은 재생 비중·기상 배수와 무관한 고정 지수라, 이 값에 지역 수력 계수만 곱한다
# (simulate() 참고). 값은 종전 simulate() 안에 있던 45 를 이름만 붙여 꺼낸 것이라
# 계산 결과는 달라지지 않는다.
#
# 이름을 준 이유: 화면의 "선정 근거" 토글이 `45 × 0.20 = 9` 처럼 계산 과정을 그대로
# 보여준다. 그 숫자를 프론트에 다시 적어두면 여기와 어긋날 수 있으므로,
# suitability_basis 로 응답에 실어 보낸다.
HYDRO_BASE_INDEX = 45.0

# 지역 효율 계수의 기준값. 1.0 = 전국 평균 (seed_db.py 주석 참고).
# "선정 근거"가 계수를 평균과 비교해 유불리를 말할 때 쓴다.
REGION_FACTOR_AVERAGE = 1.0

# 지역 효율 계수 키. 계수가 없는 지역은 전국 평균(1.0)으로 채운다.
EFF_KEYS = ("solar", "wind", "hydro", "thermal")

# 배출 시뮬레이션 곡선에서 재생에너지를 얼마나(%p) 올려볼지.
# 0(현재)은 build_projection 이 항상 앞에 붙인다.
PROJECTION_STEPS = (10, 20, 30)


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _josa(word: str, with_jong: str, without_jong: str) -> str:
    """받침 유무에 따라 조사를 붙인다 ("화석연료를" / "원자력을")."""
    code = ord(word[-1])
    has_jong = 0xAC00 <= code <= 0xD7A3 and (code - 0xAC00) % 28 != 0
    return word + (with_jong if has_jong else without_jong)


def _delta_phrase(delta: float) -> str:
    return f"{abs(delta):.0f}%p {'높이면' if delta > 0 else '낮추면'}"


def _factor_status(score: float) -> str:
    if score >= 75.0:
        return "good"
    if score >= 50.0:
        return "warn"
    return "bad"


def normalize_mix(mix_values: dict) -> dict:
    """믹스 합계를 100%로 맞춘다.

    프론트엔드는 항상 합계 100으로 보내지만(page.tsx:60-113), API를 직접
    호출하면 합계가 100이 아닐 수 있다. 그 경우 점수가 정의역을 벗어나므로
    정규화한다. 합계가 이미 100(±0.5)이면 원본을 그대로 돌려주어
    기존 응답값과 비트 단위로 동일하게 유지한다.
    """
    total = sum(mix_values[k] for k in MIX_KEYS)
    if abs(total - 100.0) <= 0.5:
        return dict(mix_values)
    if total <= 0:
        return {"renewable": 33.3, "nuclear": 33.3, "fossil": 33.4}
    return {k: mix_values[k] / total * 100.0 for k in MIX_KEYS}


REDISTRIBUTE_FLOOR = 0.5
"""재분배 가중치에 두 축 모두에게 얹어주는 최소 지분(%p).

순수 비율만 쓰면 0%인 축은 가중치가 영원히 0이라 되살아나지 못하고, 두 축의
합이 아주 작을 때(예: 0.2 대 0)는 반올림 수준의 차이가 100:0 쏠림으로 증폭된다.
두 축에 같은 값을 더해 가중치를 만들면 두 경우 모두 완만해지고, 합이 0이면
정확히 50:50이 되어 기존 예외 분기(current_total_other <= 0)를 그대로 대체한다.
프론트엔드 REDISTRIBUTE_FLOOR(page.tsx)와 반드시 같은 값이어야 한다.
"""


def redistribute(mix_values: dict, lever: str, new_value: float) -> dict:
    """한 축을 new_value로 바꾸고 나머지 둘을 기존 비율대로 재분배한다.

    프론트엔드 redistributeMix(page.tsx)와 동일한 규칙이다.
    두 곳의 규칙이 같아야 next_action이 약속한 점수가 실제로 재현된다.
    """
    others = [k for k in MIX_KEYS if k != lever]
    first_share = max(mix_values[others[0]], 0.0)
    second_share = max(mix_values[others[1]], 0.0)
    current_total_other = first_share + second_share
    new_total_other = 100.0 - new_value

    # 최소 지분은 나머지 두 축이 몫을 "돌려받는" 방향일 때만 얹는다.
    # 늘어나는 몫에만 바닥을 깔면 0%인 축이 다시 자라면서도, lever를 올릴 때
    # (=두 축이 줄어들 때)의 순수 비율은 종전 그대로다. 후자까지 건드리면
    # "재생을 올렸는데 0이던 화석이 되살아나 배출량이 오히려 는다"가 생겨
    # build_projection이 약속한 단조 감소가 깨진다.
    floor = REDISTRIBUTE_FLOOR if new_total_other > current_total_other else 0.0
    first_weight = first_share + floor
    second_weight = second_share + floor
    total_weight = first_weight + second_weight

    if total_weight <= 0:
        # lever가 100%라 나눠줄 몫 자체가 없는 경우
        first = second = new_total_other / 2.0
    else:
        first = new_total_other * (first_weight / total_weight)
        second = new_total_other * (second_weight / total_weight)

    return {lever: new_value, others[0]: first, others[1]: second}


def simulate(mix_values: dict, eff_map: dict, weather: dict) -> dict:
    """순수 계산부. DB도 LLM도 건드리지 않는다.

    후보 믹스를 반복 평가해야 하므로(find_next_action) 엔드포인트에서 분리했다.

    ── 기상 → 적합도 → 배출량으로 이어지는 하나의 인과 사슬 ──

    예전에는 배출량이 믹스만 보고 계산됐다(믹스 비율 × 배출계수). 그래서 기상
    시나리오를 바꾸면 적합도·공급량은 움직이는데 배출량은 그대로였고, 화면의 두
    축(기후 탭 / 믹스 슬라이더)이 서로 무관한 기능처럼 보였다.

    실제로는 이어져 있다. 배출강도의 단위는 gCO2/kWh — "실제로 인도된 1kWh당"
    배출량이다. 태풍이면 풍력이 멈추고(wind_mult 0) 태양광도 10%만 남으므로,
    계획한 재생 비중은 그만큼 전력을 만들어내지 못한다. 그러면 실제 인도 전력에서
    화력이 차지하는 비중이 올라가고, 1kWh당 배출량도 함께 올라간다.

    그래서 배출강도를 "계획 비중"이 아니라 "실제 발전 구성"의 가중평균으로 낸다.
    실제 발전 구성은 이미 production 이 쓰던 분해를 그대로 재사용하므로,
    배출량과 전력망 판정이 같은 하나의 발전량 벡터에서 나온다.

    배출계수(EMISSION_FACTORS)와 적합도 계산식은 손대지 않았다. 기상이라는
    입력 변수가 배출량 쪽으로도 흐르게 연결만 했다.

    carbon         — 기상 반영. 실제 인도 전력 1kWh당 배출량
    carbon_planned — 기존 값. 믹스 자체의 배출강도(기상 무관). 화면이 "기상 때문에
                     얼마나 달라졌는지"를 설명할 수 있도록 함께 내려보낸다.
    """
    # 믹스 비율(%) × 발전원별 배출계수의 가중평균. 계수 출처는 EMISSION_FACTORS 주석 참고.
    planned_carbon = sum(mix_values[key] * EMISSION_FACTORS[key] for key in MIX_KEYS) / 100

    final_solar = mix_values["renewable"] * eff_map.get("solar", 1.0) * weather["solar_mult"]
    final_wind = mix_values["renewable"] * eff_map.get("wind", 1.0) * weather["wind_mult"]

    suitability = {
        "태양광": min(100, final_solar),
        "풍력": min(100, final_wind),
        "수력": min(100, HYDRO_BASE_INDEX * eff_map.get("hydro", 1.0)),
        "화력": min(100, mix_values["fossil"] * eff_map.get("thermal", 1.0)),
    }

    # 실제 발전 구성. 재생은 기상 배수를 그대로 받고, 원자력·화력은 급전 가능
    # 전원이라 기상과 무관하다. 합계는 기존 production 식과 같은 값이다.
    delivered = {
        "renewable": (final_solar + final_wind) / 2,
        "nuclear": mix_values["nuclear"],
        "fossil": mix_values["fossil"],
    }
    production = sum(delivered.values())
    demand = 100 * weather["demand_mult"]

    # 가중평균이므로 결과는 항상 [CARBON_BEST, CARBON_WORST] 안에 있다 —
    # 점수 환산(score_factors)의 정의역이 그대로 유지된다.
    # 인도 전력이 0이면 나눌 수 없다. 그때는 믹스 자체의 배출강도로 떨어뜨린다
    # (전력이 없다는 사실은 grid 요인이 따로 벌점을 준다).
    carbon = (
        sum(delivered[key] * EMISSION_FACTORS[key] for key in MIX_KEYS) / production
        if production > 0
        else planned_carbon
    )

    return {
        "carbon": carbon,
        "carbon_planned": planned_carbon,
        "suitability": suitability,
        "final_solar": final_solar,
        "final_wind": final_wind,
        "delivered": delivered,
        "production": production,
        "demand": demand,
    }


def estimate_generation(mix_values: dict, eff_map: dict, weather: dict,
                        scale: dict = None) -> dict:
    """발전원별 추정 발전량(MWh). 순수 계산부.

    산출식: 지역 효율계수 × 기상 배수 × 에너지 믹스 비중 × 기준 발전 규모.
    값의 성격과 한계는 GENERATION_SCALE / GENERATION_NOTE 주석 참고.

    scale 은 마지막 항(기준 발전 규모)만 갈아끼우는 자리다. 기본값은 지금까지와
    같은 GENERATION_SCALE(임의 기준값)이고, KPX 실시간 발전원 구성비를 받아 온
    경우에만 호출부가 그 값을 넣는다. README 9.3.2 가 적어 둔 "정식 활용 전
    KPX 설비용량으로 교체" 가 정확히 이 인자다.

    **곱셈 구조는 그대로다.** 실데이터가 들어와도 슬라이더(믹스 비중)와 기후 탭
    (기상 배수)은 여전히 이 값을 움직인다 — KPX 발전량을 결과에 그대로 덮어쓰면
    도넛이 "전국이 지금 실제로 이렇게 발전하고 있다"가 되어 조작에 반응하지
    않게 되고, 그건 실데이터 연동이 아니라 기능 제거다.

    simulate()의 suitability와 다른 점이 둘 있다. 둘 다 의도한 차이다.

    1. 100 상한을 두지 않는다. suitability의 min(100, ...)은 "0~100 지수"라는
       표현 형식 때문에 있는 것이라, 발전량 추정에 그대로 쓰면 잠재력이 큰
       지역(제주 풍력 등)만 천장에 눌려 실제보다 작게 보인다.
    2. 수력에도 재생 비중을 곱한다. suitability의 수력은 믹스·기상과 무관한
       고정 지수지만, 발전량으로 읽는 값이 "재생 0%인데 수력이 돌아간다"가
       되면 앞뒤가 맞지 않는다. 수력에 대응하는 기상 배수는 없으므로 1.0이다.

    원자력은 지도 차트가 다루는 4개 발전원에 없어 합계에서 빠진다.
    """
    renewable_share = mix_values["renewable"] / 100.0
    fossil_share = mix_values["fossil"] / 100.0
    # 넘어온 표에 발전원이 빠져 있어도 계산이 멈추지 않게 기본 표로 메운다.
    used = GENERATION_SCALE if scale is None else {**GENERATION_SCALE, **scale}

    return {
        "태양광": eff_map.get("solar", 1.0) * weather["solar_mult"] * renewable_share * used["태양광"],
        "풍력": eff_map.get("wind", 1.0) * weather["wind_mult"] * renewable_share * used["풍력"],
        "수력": eff_map.get("hydro", 1.0) * renewable_share * used["수력"],
        "화력": eff_map.get("thermal", 1.0) * fossil_share * used["화력"],
    }


def build_grid(sim: dict) -> dict:
    """전력망 상태를 구조화한다.

    기존에는 문자열 하나("불안정 (전력 부족 위험)")만 내려보내 프론트가
    .includes()/.split()으로 파싱했다(page.tsx:461-467). 문구가 바뀌면 조용히
    깨지는 구조라 status enum을 추가한다. 판정 기준은 기존과 동일하다.
    """
    production = sim["production"]
    demand = sim["demand"]

    if production < demand:
        status, label = "deficit", "불안정 (전력 부족 위험)"
    elif production > demand + SURPLUS_MARGIN:
        status, label = "surplus", "안정 (에너지 과잉/출력제한 필요)"
    else:
        status, label = "stable", "안정"

    return {
        "status": status,
        "label": label,
        "production": round(production, 1),
        "demand": round(demand, 1),
        "margin": round(production - demand, 1),
        "margin_pct": round((production - demand) / demand * 100, 1) if demand else 0.0,
    }


def score_factors(sim: dict, mix_values: dict, eff_map: dict, weather: dict, region: str) -> list:
    """지속가능성 지수를 구성하는 3개 요인을 각각 0~100으로 채점한다.

    귀인(attribution)을 위해 총점만이 아니라 "무엇이 몇 점을 깎았는지"를 함께 낸다.
    """
    # 1) 탄소 배출: 화력 100%(CARBON_WORST) → 0점, 무탄소 100%(CARBON_BEST) → 100점
    carbon = sim["carbon"]
    carbon_score = _clamp(100.0 * (CARBON_WORST - carbon) / (CARBON_WORST - CARBON_BEST))
    carbon_cut = (CARBON_WORST - carbon) / CARBON_WORST * 100.0

    # 2) 전력망 안정: 공급 부족은 부족률의 2배로, 과잉은 초과분만큼 감점
    production, demand = sim["production"], sim["demand"]
    if demand <= 0:
        grid_score = 0.0
    elif production < demand:
        shortfall_pct = (demand - production) / demand * 100.0
        grid_score = _clamp(100.0 - shortfall_pct * 2.0)
    elif production > demand + SURPLUS_MARGIN:
        excess = production - (demand + SURPLUS_MARGIN)
        grid_score = _clamp(100.0 - excess * 2.0)
    else:
        grid_score = 100.0

    # 3) 지역 적합도: 이 지역·이 날씨의 재생에너지 실현 잠재력과 재생 비중이 얼마나 맞는지
    #    PRD Module 1("내 지역은 어떤 에너지가 유리할까")을 점수로 옮긴 것이다.
    potential = (eff_map.get("solar", 1.0) * weather["solar_mult"]
                 + eff_map.get("wind", 1.0) * weather["wind_mult"]) / 2.0
    potential_norm = max(0.0, min(1.0, potential / POTENTIAL_SCALE))
    renewable_share = max(0.0, min(1.0, mix_values["renewable"] / 100.0))
    fit_score = _clamp(100.0 * (1.0 - abs(renewable_share - potential_norm)))

    # 기상 때문에 배출강도가 달라졌으면 그 사실을 함께 적는다. 이 문구가 없으면
    # 기후 시나리오만 바꿨는데 탄소 점수가 움직이는 이유를 화면에서 알 수 없다.
    planned = sim.get("carbon_planned", carbon)
    carbon_detail = f"{carbon:.1f} gCO2/kWh · 화력 100% 대비 {carbon_cut:.0f}% 감축"
    if abs(carbon - planned) >= 0.5:
        carbon_detail += f" · 믹스 자체는 {planned:.1f}g, 이 기상에서 {carbon - planned:+.1f}g"

    raw = [
        ("carbon", "탄소 배출", carbon_score, carbon_detail),
        ("grid", "전력망 안정", grid_score,
         f"공급 {production:.0f} / 수요 {demand:.0f}"),
        ("fit", "지역 적합도", fit_score,
         f"{region} 재생에너지 잠재력 {potential:.2f} · 현재 재생 비중 {renewable_share * 100:.0f}%"),
    ]

    factors = []
    for key, label, score, detail in raw:
        weight = FACTOR_WEIGHTS[key]
        factors.append({
            "key": key,
            "label": label,
            "score": round(score, 1),
            "weight": weight,
            "contribution": round(score * weight, 1),      # 총점에 기여한 점수
            "penalty": round((100.0 - score) * weight, 1),  # 이 요인 때문에 잃은 점수
            "status": _factor_status(score),
            "detail": detail,
        })
    return factors


def composite_score(factors: list) -> float:
    """요인 점수의 가중합. 0~100."""
    return sum(f["score"] * f["weight"] for f in factors)


def evaluate_goal(score: float) -> dict:
    """C-1: 목표 명시. 무엇을 달성해야 하는지, 얼마나 남았는지."""
    return {
        "target": GOAL_TARGET,
        "current": round(score, 1),
        "gap": round(max(0.0, GOAL_TARGET - score), 1),
        "progress_pct": round(_clamp(score / GOAL_TARGET * 100.0), 1),
        "achieved": score >= GOAL_TARGET,
    }


def evaluate_level(score: float) -> dict:
    """C-2: 단계적 성공 경험. 100점이 아니라 다음 한 단계를 목표로 만든다."""
    current = PROGRESS_LEVELS[0]
    for level in PROGRESS_LEVELS:
        if score >= level["min_score"]:
            current = level
    next_level = next((l for l in PROGRESS_LEVELS if l["min_score"] > score), None)

    return {
        "current": current,
        "next": next_level,
        "to_next": round(next_level["min_score"] - score, 1) if next_level else 0.0,
        "total_levels": len(PROGRESS_LEVELS),
    }


def _evaluate(mix_values: dict, eff_map: dict, weather: dict, region: str) -> tuple:
    """(총점, sim, factors) — 후보 믹스 평가에 재사용한다."""
    sim = simulate(mix_values, eff_map, weather)
    factors = score_factors(sim, mix_values, eff_map, weather, region)
    return composite_score(factors), sim, factors


# 개선된 요인별 제안 사유 템플릿. 실제로 가장 많이 오른 요인에 맞춰 고르므로
# 문구와 수치가 어긋날 수 없다.
_REASON_TEMPLATES = {
    "carbon": "{lever_label} 비중을 {delta_desc} 탄소 배출이 {carbon_delta:.0f}g 줄어듭니다.",
    "grid": "{lever_label} 비중을 {delta_desc} 공급이 수요에 {margin_desc}, 전력망이 안정됩니다.",
    "fit": "{region}의 재생에너지 잠재력({potential:.2f})에 비해 현재 재생 비중이 {fit_desc}. "
           "{lever_josa} {delta_desc} 지역 여건에 더 맞습니다.",
}


def find_next_action(mix_values: dict, eff_map: dict, weather: dict, region: str,
                     current_score: float, current_sim: dict, current_factors: dict) -> dict:
    """C-3: 통제감. 지금 할 수 있는 최선의 조정 1개를 결정론적으로 찾는다.

    세 축 × 네 조정폭 = 최대 12회의 순수 계산이라 비용은 무시할 수준이다.
    재분배 규칙이 프론트엔드와 같으므로, 반환한 resulting_mix를 그대로 적용하면
    expected_score가 실제로 재현된다.

    후보는 점수 상승량만으로 고르지 않는다. 전력망 안정성을 함께 본다.

    이유: grid 요인 점수는 0에서 하한 처리되므로, 이미 정전 위험 구간(0점)에
    들어간 뒤에는 공급이 더 줄어도 점수가 떨어지지 않는다. 그래서 점수만 보면
    "정전 상태에서 화력을 더 줄여라" 같은 후보가 탄소 개선분만으로 최선이 된다.
    학습자가 그 제안을 적용하면 더 나쁜 상태로 가므로 Confidence 설계가 역효과를 낸다.
    따라서 점수가 아니라 공급 여유(margin) 원값으로 악화 여부를 판정한다.
    """
    best = None

    current_grid = build_grid(current_sim)
    current_rank = GRID_RANK[current_grid["status"]]
    current_margin = current_sim["production"] - current_sim["demand"]

    for lever in MIX_KEYS:
        for delta in NEXT_ACTION_DELTAS:
            new_value = _clamp(mix_values[lever] + delta)
            if abs(new_value - mix_values[lever]) < 0.01:
                continue  # 0/100에 걸려 실제로 변하지 않는 후보

            candidate = redistribute(mix_values, lever, new_value)
            score, sim, factors = _evaluate(candidate, eff_map, weather, region)
            gain = score - current_score

            if gain < MIN_IMPROVEMENT:
                continue

            candidate_grid = build_grid(sim)
            candidate_rank = GRID_RANK[candidate_grid["status"]]
            candidate_margin = sim["production"] - sim["demand"]

            # (1) 이미 공급이 부족한 상태라면, 공급을 더 줄이는 행동은 제안하지 않는다.
            if current_grid["status"] == "deficit" and candidate_margin < current_margin - MARGIN_EPS:
                continue

            # (2) 전력망 등급을 떨어뜨리는 행동도 제안하지 않는다 (예: stable → deficit).
            if candidate_rank < current_rank:
                continue

            # 점수 상승량 + 전력망 등급 회복 보너스로 우선순위를 매긴다.
            priority = gain + GRID_RECOVERY_BONUS * (candidate_rank - current_rank)

            if best is None or priority > best["priority"]:
                best = {
                    "lever": lever,
                    "delta": round(new_value - mix_values[lever], 1),
                    "mix": candidate,
                    "score": score,
                    "gain": gain,
                    "priority": priority,
                    "sim": sim,
                    "grid": candidate_grid,
                    "margin_change": candidate_margin - current_margin,
                    "factors": {f["key"]: f for f in factors},
                }

    if best is None:
        return None

    # 어느 요인이 가장 많이 올랐는지로 사유를 고른다
    gains = {k: best["factors"][k]["score"] - current_factors[k]["score"] for k in FACTOR_WEIGHTS}
    primary = max(gains, key=gains.get)

    delta = best["delta"]
    lever_label = MIX_LABELS[best["lever"]]
    delta_desc = _delta_phrase(delta)
    potential = (eff_map.get("solar", 1.0) * weather["solar_mult"]
                 + eff_map.get("wind", 1.0) * weather["wind_mult"]) / 2.0

    reason = _REASON_TEMPLATES[primary].format(
        lever_label=lever_label,
        lever_josa=_josa(lever_label, "을", "를"),
        delta_desc=delta_desc,
        carbon_delta=abs(current_sim["carbon"] - best["sim"]["carbon"]),
        margin_desc="더 가까워져" if best["sim"]["production"] < best["sim"]["demand"] else "도달해",
        region=region,
        potential=potential,
        fit_desc="낮습니다" if mix_values["renewable"] / 100.0 < min(1.0, potential / POTENTIAL_SCALE) else "높습니다",
    )

    return {
        "lever": best["lever"],
        "lever_label": lever_label,
        "delta": delta,
        "resulting_mix": {k: round(v, 1) for k, v in best["mix"].items()},
        "expected_score": round(best["score"], 1),
        "expected_gain": round(best["gain"], 1),
        "expected_carbon": round(best["sim"]["carbon"], 2),
        "reaches_goal": best["score"] >= GOAL_TARGET,
        "primary_factor": primary,
        "reason": reason,
        # 전력망 검증 결과. 이 제안이 공급 안정성에 어떤 영향을 주는지 명시한다.
        "resulting_grid_status": best["grid"]["status"],
        "grid_margin_change": round(best["margin_change"], 1),
    }


def build_projection(mix_values: dict, eff_map: dict, weather: dict) -> list:
    """재생에너지를 단계별로 올렸을 때의 배출량 곡선.

    차트가 필요로 하는 건 배출량과 재생 비중뿐이라 simulate()만 부른다.
    점수·목표·다음행동 계산(analyze)은 돌리지 않는다.

    라벨 문자열은 만들지 않는다. 표현은 프론트엔드의 몫이고, 백엔드는
    숫자와 상한 도달 여부만 알려준다.
    """
    base_renewable = mix_values["renewable"]
    points = []

    for step in (0,) + PROJECTION_STEPS:
        target = _clamp(base_renewable + step)
        candidate = mix_values if step == 0 else redistribute(mix_values, "renewable", target)
        sim = simulate(candidate, eff_map, weather)
        points.append({
            "step": step,
            "renewable": round(candidate["renewable"], 1),
            "carbon_emissions": round(sim["carbon"], 2),
            # 재생 100% 상한에 걸려 step 만큼 올리지 못한 지점
            "clamped": step > 0 and target < base_renewable + step - 1e-9,
        })

    return points


def build_scenario_comparison(mix_values: dict, eff_map: dict, current_scenario: str) -> list:
    """지금 믹스를 고정한 채 4개 기후 시나리오의 배출강도를 나란히 낸다.

    "이 기후 조건에서는 배출이 이 정도"를 비교하게 하는 것이 목적이다.
    프론트엔드가 시나리오별로 /calculate 를 네 번 부르지 않아도 되고, 무엇보다
    같은 simulate() 를 쓰므로 비교 그래프와 화면의 대표 수치가 어긋날 수 없다.

    현재 시나리오 행은 is_current 로 표시한다. 프론트엔드가 자기 선택값으로
    판단하지 않게 하는 이유: 알 수 없는 시나리오가 들어오면 이쪽은 "맑음"으로
    폴백하는데, 그때 프론트가 자기 값으로 강조하면 강조된 행과 대표 수치가
    서로 다른 시나리오를 가리키게 된다.

    grid_status 를 함께 주는 이유는 배출이 오른 "이유"가 대개 공급 부족이라서다.
    """
    rows = []
    for scenario, profile in WEATHER_PROFILES.items():
        sim = simulate(mix_values, eff_map, profile)
        rows.append({
            "scenario": scenario,
            "carbon_emissions": round(sim["carbon"], 2),
            "grid_status": build_grid(sim)["status"],
            # 계획한 재생 비중이 이 기상에서 실제로 만들어낸 발전량(무차원)
            "renewable_delivered": round(sim["delivered"]["renewable"], 1),
            "is_current": scenario == current_scenario,
        })
    return rows


def analyze(mix_values: dict, eff_map: dict, weather: dict, region: str) -> dict:
    """시뮬레이션 + Confidence 평가를 한 번에. LLM은 호출하지 않는다."""
    score, sim, factors = _evaluate(mix_values, eff_map, weather, region)
    factor_map = {f["key"]: f for f in factors}

    return {
        "score": score,
        "sim": sim,
        "factors": factors,
        "grid": build_grid(sim),
        "goal": evaluate_goal(score),
        "level": evaluate_level(score),
        "next_action": find_next_action(mix_values, eff_map, weather, region, score, sim, factor_map),
        "projection": build_projection(mix_values, eff_map, weather),
    }


def load_efficiency_map(db: Session, region: str) -> dict:
    efficiencies = db.query(EnergyEfficiency).filter(EnergyEfficiency.region == region).all()
    eff_map = {eff.source: eff.efficiency_score for eff in efficiencies}
    if not eff_map:
        eff_map = {"solar": 1.0, "wind": 1.0, "hydro": 1.0, "thermal": 1.0}
    return eff_map


def build_suitability_basis(eff_map: dict) -> dict:
    """적합도 4개 값이 어떤 입력에서 나왔는지 화면이 되짚을 수 있게 재료를 내려보낸다.

    화면의 "선정 근거" 토글은 적합도를 그냥 서술하지 않고 계산을 그대로 재현한다
    (예: 화력 = 화석연료 33% × 서울 화력 계수 1.30 = 43). 그러려면 지역 효율 계수와
    수력 기준 지수가 프론트에 있어야 한다.

    적합도 값을 다시 계산해 보내지는 않는다 — suitability 가 이미 정답이고, 이건
    그 값이 만들어진 재료다. 두 곳에서 같은 값을 계산하면 어긋날 수 있다.
    """
    return {
        # 1.0 = 전국 평균. 계수가 없는 지역은 평균으로 채워 프론트가 결측을 다루지 않게 한다.
        "region_factors": {key: eff_map.get(key, REGION_FACTOR_AVERAGE) for key in EFF_KEYS},
        "region_factor_average": REGION_FACTOR_AVERAGE,
        "hydro_base_index": HYDRO_BASE_INDEX,
    }


def load_all_efficiency_maps(db: Session) -> dict:
    """모든 지역의 효율 계수를 한 번의 쿼리로 읽는다.

    /regions 는 17개 시·도를 한꺼번에 계산하므로, load_efficiency_map 을
    지역 수만큼 부르면 쿼리도 17번 나간다. 삽입 순서(seed_db.py)를 그대로
    유지해 응답의 지역 순서가 호출마다 흔들리지 않게 한다.
    """
    eff_maps: dict = {}
    for eff in db.query(EnergyEfficiency).all():
        eff_maps.setdefault(eff.region, {})[eff.source] = eff.efficiency_score
    return eff_maps


def build_fallback_message(region: str, weather: dict, analysis: dict) -> str:
    """AI 호출이 실패해도 Confidence 피드백은 살아남아야 한다.

    기존 fallback(구 105행)은 배출량 숫자만 알려주고 끝나서, Gemini 장애 =
    학습 지원 전면 소실이었다. 목표와 다음 행동은 이미 계산되어 있으므로
    그것으로 문장을 만든다.
    """
    goal, level = analysis["goal"], analysis["level"]
    parts = [f"[{region}/{weather['msg']}]"]

    if goal["achieved"]:
        parts.append(f"목표 {goal['target']:.0f}점을 넘겼습니다. 현재 {goal['current']}점 "
                     f"({level['current']['name']} 단계).")
    else:
        parts.append(f"현재 {goal['current']}점, 목표까지 {goal['gap']}점 남았습니다 "
                     f"({level['current']['name']} 단계).")

    action = analysis["next_action"]
    if action:
        parts.append(f"{_josa(action['lever_label'], '을', '를')} "
                     f"{_delta_phrase(action['delta'])} {action['expected_score']}점이 됩니다.")
    return " ".join(parts)


async def run_simulation(mix: EnergyMix, db: Session, reuse_ai_message: str = None) -> dict:
    """/calculate 의 본체.

    reuse_ai_message 가 주어지면 LLM을 호출하지 않고 그 문장을 그대로 쓴다.
    서버측 PDF 엔드포인트가 화면에 이미 떠 있는 해설을 다시 만들지 않게 하려고
    둔 통로다. 그 엔드포인트는 제거됐지만(PDF 는 브라우저에서 jsPDF 로 만든다)
    같은 계산을 해설 재생성 없이 다시 받는 길로는 여전히 유효하다.
    """
    # 폴백 결과를 이름으로 붙잡아 둔다. build_scenario_comparison 이 어느 행을
    # "현재"로 표시할지 이 이름으로 판단하므로, .get() 만 쓰면 알 수 없는
    # 시나리오가 왔을 때 대표 수치(맑음)와 강조 행(미지의 값)이 어긋난다.
    scenario_key = mix.weather_scenario if mix.weather_scenario in WEATHER_PROFILES else "맑음"
    weather = WEATHER_PROFILES[scenario_key]
    eff_map = load_efficiency_map(db, mix.region)

    raw_mix = {k: getattr(mix, k) for k in MIX_KEYS}
    mix_values = normalize_mix(raw_mix)

    analysis = analyze(mix_values, eff_map, weather, mix.region)

    carbon_round = round(analysis["sim"]["carbon"], 2)
    renewable_round = round(mix_values["renewable"])
    best_source = max(analysis["sim"]["suitability"], key=analysis["sim"]["suitability"].get)
    grid = analysis["grid"]

    # AI 설명 생성. 실패하거나 비활성화되면 결정론적 fallback을 쓴다.
    # NOTE: agent.py의 AgentState는 아직 Confidence 필드를 받지 않으므로
    #       state는 기존 스키마를 그대로 유지한다. (agent.py 개선은 다음 단계)
    ai_msg = build_fallback_message(mix.region, weather, analysis)
    # 이 문장이 LLM이 쓴 것인지 결정론적 요약인지 화면에서 구분할 수 있게 한다.
    # 두 문장이 같은 자리·같은 라벨로 나오면 사용자는 구분할 방법이 없다.
    # 확신이 없으면 항상 "fallback" 쪽으로 둔다 — LLM이 쓰지 않은 문장을
    # AI 생성이라고 표기하는 쪽이 그 반대보다 나쁘기 때문이다.
    ai_source = "fallback"
    if reuse_ai_message:
        # 이미 생성된 해설을 그대로 사용한다 (PDF 경로).
        # 그 문장이 원래 어떻게 만들어졌는지는 여기서 알 수 없으므로 fallback 으로 둔다.
        ai_msg = reuse_ai_message
    elif mix.include_ai and not AI_DISABLED and summary_graph is not None:
        try:
            # 폴백 문장을 그래프에 함께 넣는다. LLM 문장을 받아내지 못했을 때
            # 무엇으로 대체할지는 postprocess 노드가 정한다 — 폴백 여부를 정하는
            # 곳이 한 군데여야 화면의 ai_source 배지와 문장이 어긋나지 않는다.
            #
            # 그래프는 예외를 던지지 않도록 만들어져 있다. 이 try 는 그럼에도
            # 새어 나올 수 있는 예외까지 폴백으로 떨어뜨리는 안전망이다.
            final_state = await summary_graph.ainvoke({
                "region": mix.region,
                "weather_scenario": mix.weather_scenario,
                "weather_msg": weather["msg"],
                "energy_mix": f"신재생 {renewable_round}%, 원자력 {mix_values['nuclear']}%, 화력 {mix_values['fossil']}%",
                "grid_stability": grid["label"],
                "carbon_emissions": carbon_round,
                "best_source": best_source,
                "fallback_message": ai_msg,
            })
            ai_msg = final_state["ai_message"]
            ai_source = final_state["ai_source"]
        except Exception as e:
            print(f"Agent Error: {e}")

    return {
        # --- 기존 필드 (하위 호환: 프론트엔드 수정 없이 그대로 동작) ---
        # carbon_emissions 는 이제 기상까지 반영한 값이다 (simulate() 주석 참고).
        "carbon_emissions": carbon_round,
        # 믹스 자체의 배출강도(기상 무관). "기상 때문에 얼마나 달라졌는지"를
        # 화면이 한 줄로 설명할 수 있게 함께 내려보낸다.
        "carbon_planned": round(analysis["sim"]["carbon_planned"], 2),
        # 같은 믹스로 4개 기후 시나리오를 비교한 결과
        "carbon_by_scenario": build_scenario_comparison(mix_values, eff_map, scenario_key),
        "sustainability_score": round(analysis["score"], 1),
        "suitability": analysis["sim"]["suitability"],
        # 위 suitability 4개 값이 어떤 입력에서 나왔는지 (지역 계수·수력 기준 지수).
        # 화면의 "선정 근거" 토글이 계산 과정을 그대로 재현하는 데 쓴다.
        "suitability_basis": build_suitability_basis(eff_map),
        "ai_message": ai_msg,
        "current_region": mix.region,
        "grid_stability": grid["label"],
        "weather_info": weather,
        # --- Confidence 신규 필드 ---
        # ai_message 가 LLM 생성인지("llm") 결정론적 요약인지("fallback")
        "ai_source": ai_source,
        "goal": analysis["goal"],
        "level": analysis["level"],
        "factors": analysis["factors"],
        "next_action": analysis["next_action"],
        "grid": grid,
        "mix_used": {k: round(v, 1) for k, v in mix_values.items()},
        "projection": analysis["projection"],
        # 이 응답의 적합도·점수를 만든 지역 계수가 어디서 온 값인지.
        #
        # 요청 시점의 실시간 호출 결과가 아니라 **seed 시점의 출처**다 (계수는 DB 에
        # 들어 있고 요청마다 다시 받아오지 않는다). 그래서 화면 각주 교체는 이 값이
        # 아니라 /regions 의 data_source 를 본다 — 이름이 같아도 가리키는 것이 다르다.
        "data_source": COEFFICIENT_SOURCE["data_source"],
        "data_source_detail": COEFFICIENT_SOURCE,
    }


# seed 기록은 프로세스가 사는 동안 바뀌지 않는다(바뀌면 seed 를 다시 돌린 것이고,
# 그때는 서버도 다시 띄운다). 요청마다 파일을 열지 않도록 한 번만 읽는다.
COEFFICIENT_SOURCE = read_coefficient_source()


@app.post("/calculate")
async def calculate_impact(mix: EnergyMix, db: Session = Depends(get_db)):
    return await run_simulation(mix, db)


@app.post("/regions")
async def region_breakdown(query: RegionQuery, db: Session = Depends(get_db)):
    """전 지역의 발전원별 추정 발전량(MWh)과 그 합계를 한 번에 돌려준다.

    지도의 마커 크기(합계)와 클릭 시 뜨는 원형 차트(발전원별 구성)에 쓴다.
    /calculate 는 선택한 한 지역만 계산하므로 지역 간 비교에 쓸 수 없었다.

    [중요] 실제 발전량 통계가 아니라 추정 시뮬레이션값이다. 산출식과 한계는
           estimate_generation() / GENERATION_SCALE 주석에 있고, 같은 내용을
           응답의 unit·note·scale 필드로도 내보낸다 — 이 API를 직접 호출하는
           쪽도 값의 성격을 알 수 있어야 한다.

           /calculate 의 suitability(0~100 무차원 적합도 지수)와는 다른 값이다.
           같은 입력에서 서로 비례하지도 않는다(위 함수의 주석 참고).
    """
    weather = WEATHER_PROFILES.get(query.weather_scenario, WEATHER_PROFILES["맑음"])
    mix_values = normalize_mix({k: getattr(query, k) for k in MIX_KEYS})

    # KPX 실시간 발전원 구성비를 먼저 시도한다. 실패하면(키 미설정·상류 장애·
    # 응답 형식 불일치) None 이 오고, 아래 계산이 지금까지와 똑같은 임의 기준값으로
    # 돌아간다 — 화면이 깨지거나 빈 값이 뜨는 경로는 없다.
    live = await kpx_api.generation_scale() if kpx_api is not None else None
    is_live = live is not None
    scale_values = live["scale"] if is_live else GENERATION_SCALE

    regions = []
    for region, eff_map in load_all_efficiency_maps(db).items():
        generation = estimate_generation(mix_values, eff_map, weather, scale_values)
        regions.append({
            "name": region,
            "sources": {k: round(v, 1) for k, v in generation.items()},
            # 원형 차트가 이 합계로 비율을 내므로 반올림 전 값을 더한다.
            # 반올림한 값을 더하면 조각 비율의 합이 100%에서 미세하게 벗어난다.
            "total_generation": round(sum(generation.values()), 1),
        })

    return {
        "regions": regions,
        "unit": GENERATION_UNIT,
        # 실데이터를 썼는지에 따라 note 자체가 달라진다. 두 경우에 참인 내용이
        # 다르므로 한 문구를 돌려 쓰지 않는다 (GENERATION_NOTE_LIVE 주석 참고).
        "note": GENERATION_NOTE_LIVE if is_live else GENERATION_NOTE,
        # 화면이 각주를 갈아 끼우는 기준. 이 API 를 직접 부르는 쪽도 값의 성격을
        # 알 수 있어야 하므로 문구와 함께 기계가 읽을 수 있는 형태로도 내보낸다.
        "data_source": SOURCE_LIVE if is_live else SOURCE_FALLBACK,
        # 채점에 쓰인 배출계수를 /confidence/levels 가 공개하는 것과 같은 이유로,
        # 발전량 추정에 쓴 기준 규모도 그대로 공개한다.
        "scale": {
            "values": scale_values,
            "unit": "MWh",
            "source": (
                "KPX 발전원별 발전량 현황의 구성비를 반영 (총합 크기는 추정 기준값)"
                if is_live
                else "미확인 — 임의 기준값. 공식 인용 전 KPX 지역·발전원별 설비용량으로 교체 필요"
            ),
            # 실데이터일 때만 붙는다. 심사·검증 시 "무엇을 얼마나 받아 왔는지"를
            # 화면 밖에서도 확인할 수 있어야 한다.
            **({"live_ratios_pct": live["ratios"]} if is_live else {}),
        },
    }


@app.post("/chat")
async def chat(request: ChatRequest):
    """화면 상태를 컨텍스트로 삼는 자유 질의응답.

    OpenRouter 키는 이 프로세스 안에서만 쓰인다. 프론트는 이 엔드포인트만
    부르므로 브라우저 번들에 키가 실릴 자리가 없다.

    실패를 200 + 안내 문구로 위장하지 않고 503 으로 돌려준다. 그래야 화면이
    "AI가 그렇게 답했다"와 "답을 못 받았다"를 구분해 표시할 수 있다.
    사용자에게 보이는 안내는 프론트가 붙인다.
    """
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="질문 내용이 비어 있습니다.")

    # AI 전면 비활성화 스위치는 해설과 대화 모두에 걸린다.
    # 여기만 살려두면 오프라인 데모에서 이 경로로 외부 호출이 새어 나간다.
    if AI_DISABLED:
        raise HTTPException(
            status_code=503,
            detail="AI 기능이 비활성화되어 있습니다 (CLIMATELOOP_DISABLE_AI).",
        )

    try:
        reply = await ask_assistant(
            message,
            request.context.model_dump(),
            [turn.model_dump() for turn in request.history],
        )
    except OpenRouterError as exc:
        print(f"[chat] 실패: {exc}")
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"reply": reply, "model": OPENROUTER_MODEL}


@app.get("/api/weather/scenario")
async def weather_scenario(region: str = "서울"):
    """지금 이 지역의 실황·특보로 본 4종 시나리오 추천값.

    **추천만 한다.** 화면의 기후 탭은 그대로 사용자 것이다 — 이 응답이 탭 선택을
    바꾸지 않고, 프론트는 참고 배지 하나만 띄운다. 시뮬레이터의 핵심 조작이
    "내가 조건을 바꿔 본다"인데 실황이 그 선택을 덮어쓰면 조작감이 사라진다.
    (README 1.4 의 4종 수동 토글은 유지)

    source 가 "fallback" 이면 화면은 배지를 아예 렌더링하지 않는다. 추측성 판정을
    실시간 데이터처럼 보이게 하지 않기 위한 것이고, 그래서 이 엔드포인트는
    실패했을 때 200 + fallback 을 돌려준다 — 500 을 던지면 프론트가 "실패"와
    "판정 불가"를 구분하려 애써야 하고, 어차피 화면이 할 일은 배지를 접는 것뿐이다.

    scenario 는 실패 시에도 WEATHER_PROFILES 의 기본 키("맑음")를 담아 보낸다.
    필드가 비거나 사라지는 경우를 만들지 않는다 — 있는 필드는 항상 유효한 값이다.
    """
    if weather_api is None:
        return {"scenario": "맑음", "source": SOURCE_FALLBACK, "raw": {}}

    recommended = await weather_api.recommend_scenario(region)
    if recommended is None:
        # 실패 이유는 서버 로그에 남는다(services 계층이 남긴다). 화면에는
        # "판정하지 못했다"만 전달하면 되고, 그 표현은 배지를 접는 것이다.
        return {"scenario": "맑음", "source": SOURCE_FALLBACK, "raw": {}}

    return {
        "scenario": recommended["scenario"],
        "source": SOURCE_LIVE,
        "region": region,
        "raw": recommended["raw"],
    }


@app.get("/confidence/levels")
async def confidence_levels():
    """단계 체계와 채점 가중치를 공개한다.

    학습자가 규칙을 미리 알 수 있어야 목표가 목표로 기능한다(C-1).
    프론트엔드가 레벨 이름을 하드코딩하지 않아도 되게 하는 목적도 있다.
    """
    return {
        "target": GOAL_TARGET,
        "levels": PROGRESS_LEVELS,
        # 채점에 쓰인 배출계수를 그대로 공개한다. 심사·검증 시 값을 눈으로 확인할 수 있어야 한다.
        "emission_factors": {
            "unit": "gCO2/kWh",
            "values": EMISSION_FACTORS,
            "note": EMISSION_FACTOR_NOTE,
            "source": "미확인 — 공식 인용 전 GIR/EG-TIPS 공표 계수로 교체 필요",
        },
        "factors": [
            {"key": "carbon", "label": "탄소 배출", "weight": FACTOR_WEIGHTS["carbon"],
             "description": f"배출량 {CARBON_WORST:.0f}g(화력 100%)에서 {CARBON_BEST:.0f}g(무탄소 100%)까지를 0~100점으로 환산. "
                            f"{EMISSION_FACTOR_NOTE}"},
            {"key": "grid", "label": "전력망 안정", "weight": FACTOR_WEIGHTS["grid"],
             "description": "공급이 수요에 못 미치면 부족률의 2배만큼, 과잉이면 초과분만큼 감점"},
            {"key": "fit", "label": "지역 적합도", "weight": FACTOR_WEIGHTS["fit"],
             "description": "해당 지역·기상 조건의 재생에너지 잠재력과 선택한 재생 비중의 일치도"},
        ],
    }
