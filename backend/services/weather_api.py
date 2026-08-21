"""기상청 실황·특보 연동 → 4종 시나리오 "추천값" 산출.

**이 모듈은 시나리오를 추천만 한다. 고르는 것은 사용자다.**

기존 4종 수동 토글(맑음 / 흐림·비 / 태풍 / 겨울)은 그대로 남는다. 여기서 나온 값은
화면의 참고 배지로만 쓰이고 탭 선택을 자동으로 바꾸지 않는다 — 시뮬레이터의 요점이
"내가 조건을 바꿔 보는 것"이므로, 실황이 사용자의 선택을 덮어쓰면 조작감이 사라진다.
(README 1.4 "기상 시나리오 선택" 항목의 4종 토글은 유지)

쓰는 API 두 개:
  1. 단기예보 getUltraSrtNcst (초단기실황) — 기온(T1H)·강수형태(PTY)·풍속(WSD)
  2. 기상특보 getWthrWrnList — 발효 중인 특보 유무

판별 규칙(요구사항 그대로):
  ① 태풍·강풍류 특보 발효  → "태풍"
  ② 강수형태(PTY) > 0      → "흐림/비"
  ③ 기온(T1H) <= 0         → "겨울"
  ④ 그 외                  → "맑음"

특보를 가장 앞에 두는 이유: 특보는 "지금 위험하다"는 기상청의 판단이고, 실황 값은
그 판단의 재료 중 일부다. 태풍이 접근 중인데 마침 비가 그친 순간의 PTY=0 을 보고
"맑음"이라고 말하면 안 된다.

실패 정책: 두 호출 중 **어느 하나라도** 실패하면 source="fallback" 이다. 반쪽짜리
근거로 "기상청 실시간"을 주장하지 않는다 (README 9.3 면책 원칙). 화면은 fallback 일
때 배지 자체를 렌더링하지 않으므로, 추측이 실시간처럼 보이는 경로가 없다.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from services.public_api import (
    cached,
    extract_items,
    get_json,
    service_key,
    to_float,
    PUBLIC_DATA_KEY_ENV,
)

# ---------------------------------------------------------------------------
# 엔드포인트
#
# 공공데이터포털은 같은 서비스의 상세기능 URL 이 신청 시점·버전에 따라 갈린다
# (VilageFcstInfoService 와 _2.0 이 함께 살아 있는 기간이 있었다). 그래서 코드에
# 못박지 않고 환경변수로 갈아끼울 수 있게 두고, 기본값만 현행 경로로 적어 둔다.
# 경로가 틀리면 404 가 나고 그대로 폴백이므로 화면은 깨지지 않는다.
# ---------------------------------------------------------------------------
KMA_NCST_URL = os.getenv(
    "KMA_NCST_URL",
    "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
)
KMA_WARNING_URL = os.getenv(
    "KMA_WARNING_URL",
    "http://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList",
)

# 인증키 환경변수 이름. 값은 backend/.env 에서만 읽는다 — 프론트엔드
# (NEXT_PUBLIC_*)에 넣으면 브라우저 번들에 그대로 실린다.
# kpx_api 와 같은 공용 이름을 쓴다. 종전 KMA_SERVICE_KEY 에는 data.go.kr 키가
# 아닌 값(22자)이 들어 있어 기상청 호출이 code 30 으로 죽어 있었다 —
# 이름을 하나로 모으면 그 불일치가 생길 자리가 없어진다.
KMA_KEY_ENV = PUBLIC_DATA_KEY_ENV

# 한국 표준시. 기상청 API 의 base_date/base_time 은 KST 기준이므로, 서버가 어느
# 타임존에서 돌든 같은 값을 만들어야 한다 (UTC 서버에서 9시간 전 실황을 묻는 사고 방지).
KST = timezone(timedelta(hours=9))

# ---------------------------------------------------------------------------
# 17개 시·도 대표 지점의 기상청 격자 좌표(nx, ny)
#
# 기상청 격자는 5km 단위이므로 시·도 전체를 한 점으로 대표할 수는 없다. 각 시·도의
# 도청/광역시청 소재지 격자를 대표값으로 쓴다 — 이 시뮬레이터가 요구하는 것은
# "지금 이 지역이 4종 중 어디에 가까운가"라는 한 단계 분류이고, 그 정도 해상도에는
# 대표 지점이면 충분하다. 시·군·구 단위 확장은 README 1.4 의 향후 계획이다.
#
# seed_db.py 의 17개 지역명과 키가 정확히 일치해야 한다. 어긋나면 그 지역만
# 조용히 폴백된다.
# ---------------------------------------------------------------------------
REGION_GRID = {
    "서울": (60, 127),
    "부산": (98, 76),
    "대구": (89, 90),
    "인천": (55, 124),
    "광주": (58, 74),
    "대전": (67, 100),
    "울산": (102, 84),
    "세종": (66, 103),
    "경기": (60, 121),   # 수원
    "강원": (73, 134),   # 춘천
    "충북": (69, 106),   # 청주
    "충남": (68, 100),   # 홍성
    "전북": (63, 89),    # 전주
    "전남": (51, 67),    # 무안
    "경북": (91, 106),   # 안동
    "경남": (91, 77),    # 창원
    "제주": (52, 38),
}

DEFAULT_REGION = "서울"

# ---------------------------------------------------------------------------
# 특보 종류 → 시나리오
#
# 특보 코드(warnVar)는 1 강풍 / 2 호우 / 3 한파 / 4 건조 / 5 폭풍해일 / 6 풍랑 /
# 7 태풍 / 8 대설 / 9 황사 / 12 폭염 이다. 다만 서비스에 따라 코드 대신 한글
# 제목(title)만 오는 경우가 있어 양쪽 다 본다.
#
# 규칙상 시나리오를 덮어쓰는 것은 **태풍·강풍류뿐**이다. 나머지 특보는 raw 에
# 그대로 실어 보내되 판정을 바꾸지 않는다 — 요구사항의 판별 규칙을 그대로 지킨다.
# (호우 특보가 떠 있으면 PTY 가 이미 0보다 클 테니 ②에서 "흐림/비"로 잡힌다.)
# ---------------------------------------------------------------------------
STORM_WARN_CODES = {"1", "6", "7"}          # 강풍, 풍랑, 태풍
STORM_WARN_KEYWORDS = ("태풍", "강풍", "풍랑")

# 특보 조회 지점. 108 = 전국. 시·도별 지점코드로 좁힐 수도 있지만, 태풍·강풍은
# 광역으로 발효되므로 전국 목록에서 걸러 읽는 편이 누락이 적다.
WARNING_STATION = "108"


def _base_datetime(now: datetime) -> tuple[str, str]:
    """초단기실황의 base_date / base_time 을 만든다.

    초단기실황은 매 정시 관측을 그 시각 40분경에 공개한다. 그래서 HH:40 이전에는
    아직 HH시 자료가 없고 (HH-1)시를 물어야 한다. 이걸 빼먹으면 매시 0~39분
    구간에서 계속 "데이터 없음"을 받는다.

    45분을 기준으로 삼아 5분의 여유를 둔다 — 공개가 몇 분 늦는 일이 있다.
    """
    reference = now if now.minute >= 45 else now - timedelta(hours=1)
    return reference.strftime("%Y%m%d"), reference.strftime("%H00")


async def _fetch_ncst(region: str) -> Optional[dict]:
    """초단기실황에서 기온·강수형태·풍속을 뽑는다. 실패하면 None.

    응답은 category(T1H/PTY/WSD/...) 별로 한 행씩 오는 형태다. 필요한 세 개만
    골라 담고, 그 셋 중 하나라도 없으면 실패로 본다 — 기온이 없으면 ③(한파)
    판정을 할 수 없고, 그 상태로 "맑음"이라고 말하면 근거 없는 단정이 된다.
    """
    key = service_key(KMA_KEY_ENV, label="kma")
    if key is None:
        return None

    nx, ny = REGION_GRID.get(region, REGION_GRID[DEFAULT_REGION])
    base_date, base_time = _base_datetime(datetime.now(KST))

    payload = await get_json(
        KMA_NCST_URL,
        {
            "serviceKey": key,
            "dataType": "JSON",
            "numOfRows": 100,
            "pageNo": 1,
            "base_date": base_date,
            "base_time": base_time,
            "nx": nx,
            "ny": ny,
        },
        label="kma:ncst",
    )

    items = extract_items(payload, label="kma:ncst")
    if not items:
        return None

    values: dict[str, float] = {}
    for item in items:
        category = str(item.get("category", "")).strip()
        if category in ("T1H", "PTY", "WSD", "RN1"):
            parsed = to_float(item.get("obsrValue"))
            if parsed is not None:
                values[category] = parsed

    # 판정에 반드시 필요한 두 값. 없으면 실황을 읽었다고 할 수 없다.
    if "T1H" not in values or "PTY" not in values:
        print(f"[kma:ncst] {region} 실황에 T1H/PTY 가 없습니다: {sorted(values)}")
        return None

    return {
        "temperature_c": values["T1H"],
        "precipitation_type": int(values["PTY"]),
        "wind_speed_ms": values.get("WSD"),
        "rainfall_mm": values.get("RN1"),
        "base_date": base_date,
        "base_time": base_time,
        "grid": {"nx": nx, "ny": ny},
    }


async def _fetch_warnings() -> Optional[dict]:
    """발효 중인 특보 목록. 실패하면 None, 특보가 없으면 빈 목록.

    "실패"와 "특보 없음"은 다르다. 특보가 없는 것은 정상적인 조회 결과이므로
    빈 목록을 성공으로 돌려준다 — 이걸 None 으로 뭉개면 평온한 날에는 배지가
    영원히 안 뜬다.
    """
    key = service_key(KMA_KEY_ENV, label="kma")
    if key is None:
        return None

    now = datetime.now(KST)
    payload = await get_json(
        KMA_WARNING_URL,
        {
            "serviceKey": key,
            "dataType": "JSON",
            "numOfRows": 50,
            "pageNo": 1,
            "stnId": WARNING_STATION,
            # 특보는 발표 후 며칠 유지되는 경우가 있어 이틀 창을 본다.
            "fromTmFc": (now - timedelta(days=1)).strftime("%Y%m%d"),
            "toTmFc": now.strftime("%Y%m%d"),
        },
        label="kma:warn",
    )

    if payload is None:
        return None

    items = extract_items(payload, label="kma:warn")

    titles: list[str] = []
    storm = False
    for item in items:
        title = str(item.get("title") or item.get("t1") or "").strip()
        code = str(item.get("warnVar") or "").strip()
        # command/그 밖의 해제 표기가 붙은 행은 발효 중이 아니다. 필드가 없는
        # 서비스도 있으므로, 제목에 "해제"가 박힌 경우까지 함께 걸러 낸다.
        if "해제" in title:
            continue
        if title:
            titles.append(title)
        if code in STORM_WARN_CODES or any(k in title for k in STORM_WARN_KEYWORDS):
            storm = True

    return {"storm": storm, "active_titles": titles[:10], "count": len(titles)}


def decide_scenario(ncst: dict, warnings: dict) -> str:
    """실황 + 특보 → 4종 중 하나. 순수 함수.

    반환값은 WEATHER_PROFILES 의 키("맑음"/"흐림/비"/"태풍"/"겨울")다. 화면에
    보이는 라벨(맑음/화창 …)로 바꾸는 것은 프론트의 몫이다 — 백엔드가 라벨을
    들고 있으면 표기를 고칠 때 두 곳을 만져야 한다.

    순서가 규칙이다. 위에서 걸리면 아래는 보지 않는다.
    """
    # ① 특보 우선. 기상청이 위험하다고 판단한 상태를 실황 수치로 덮지 않는다.
    if warnings.get("storm"):
        return "태풍"

    # ② 강수형태가 0이 아니면 비/눈이 오고 있다.
    if ncst.get("precipitation_type", 0) > 0:
        return "흐림/비"

    # ③ 영하는 한파 시나리오로 본다.
    temperature = ncst.get("temperature_c")
    if temperature is not None and temperature <= 0:
        return "겨울"

    # ④ 나머지.
    return "맑음"


async def _recommend(region: str) -> Optional[dict]:
    """실제 호출부. 캐시는 recommend_scenario() 가 씌운다."""
    ncst = await _fetch_ncst(region)
    if ncst is None:
        return None

    warnings = await _fetch_warnings()
    if warnings is None:
        # 실황만으로 판정할 수도 있지만 그러지 않는다. 규칙의 ①(특보 우선)을
        # 확인하지 못한 상태이므로, 태풍이 떠 있는데 "맑음"이라고 말할 위험이 남는다.
        # 반쪽 근거로 "기상청 실시간"을 주장하지 않는다.
        return None

    return {
        "scenario": decide_scenario(ncst, warnings),
        "raw": {
            "observation": ncst,
            "warnings": warnings,
        },
    }


async def recommend_scenario(region: str = DEFAULT_REGION) -> Optional[dict]:
    """지역의 현재 실황·특보로 추천 시나리오를 낸다. 실패하면 None.

    캐시 키에 지역과 실황 기준시각을 함께 넣는다. 기준시각을 넣으면 정시가 지나
    새 실황이 공개되는 순간 캐시가 자연히 갈리므로, TTL 이 남아 있어도 한 시간 전
    실황을 계속 보여주지 않는다.
    """
    if region not in REGION_GRID:
        region = DEFAULT_REGION
    base_date, base_time = _base_datetime(datetime.now(KST))
    return await cached(
        f"kma:scenario:{region}:{base_date}{base_time}",
        lambda: _recommend(region),
    )
