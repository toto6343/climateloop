import os

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from models.database import SessionLocal, EnergyEfficiency
from dotenv import load_dotenv

load_dotenv()

# LangGraph 에이전트는 GEMINI_API_KEY가 없으면 임포트 시점에 예외를 던진다.
# Confidence 피드백은 결정론적으로 계산되므로 AI 없이도 동작해야 한다.
# 따라서 임포트 실패를 서버 기동 실패로 만들지 않는다.
try:
    from agent import app as agent_app  # LangGraph 에이전트 앱 임포트
except Exception as agent_import_error:  # pragma: no cover
    agent_app = None
    print(f"[warn] AI 에이전트 비활성화: {agent_import_error}")

# 환경변수로 AI 호출을 끌 수 있게 한다 (테스트/오프라인 데모용)
AI_DISABLED = os.getenv("CLIMATELOOP_DISABLE_AI", "").lower() in ("1", "true", "yes")

app = FastAPI(title="ClimateLoop API")

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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
    계산식은 기존 /calculate 로직(구 52-82행)을 그대로 옮긴 것이다.
    """
    # 믹스 비율(%) × 발전원별 배출계수의 가중평균. 계수 출처는 EMISSION_FACTORS 주석 참고.
    carbon = sum(mix_values[key] * EMISSION_FACTORS[key] for key in MIX_KEYS) / 100

    final_solar = mix_values["renewable"] * eff_map.get("solar", 1.0) * weather["solar_mult"]
    final_wind = mix_values["renewable"] * eff_map.get("wind", 1.0) * weather["wind_mult"]

    suitability = {
        "태양광": min(100, final_solar),
        "풍력": min(100, final_wind),
        "수력": min(100, 45 * eff_map.get("hydro", 1.0)),
        "화력": min(100, mix_values["fossil"] * eff_map.get("thermal", 1.0)),
    }

    production = (final_solar + final_wind) / 2 + mix_values["nuclear"] + mix_values["fossil"]
    demand = 100 * weather["demand_mult"]

    return {
        "carbon": carbon,
        "suitability": suitability,
        "final_solar": final_solar,
        "final_wind": final_wind,
        "production": production,
        "demand": demand,
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

    raw = [
        ("carbon", "탄소 배출", carbon_score,
         f"{carbon:.1f} gCO2/kWh · 화력 100% 대비 {carbon_cut:.0f}% 감축"),
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
    """/calculate 와 /generate-pdf 가 공유하는 본체.

    reuse_ai_message 가 주어지면 LLM을 호출하지 않고 그 문장을 그대로 쓴다.
    PDF 리포트가 화면에 이미 떠 있는 해설을 다시 만들지 않게 하기 위한 것이다.
    """
    weather = WEATHER_PROFILES.get(mix.weather_scenario, WEATHER_PROFILES["맑음"])
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
    #       initial_state는 기존 스키마를 그대로 유지한다. (agent.py 개선은 다음 단계)
    ai_msg = build_fallback_message(mix.region, weather, analysis)
    if reuse_ai_message:
        # 이미 생성된 해설을 그대로 사용한다 (PDF 경로).
        ai_msg = reuse_ai_message
    elif mix.include_ai and not AI_DISABLED and agent_app is not None:
        try:
            initial_state = {
                "region": mix.region,
                "weather_scenario": mix.weather_scenario,
                "weather_msg": weather["msg"],
                "energy_mix": f"신재생 {renewable_round}%, 원자력 {mix_values['nuclear']}%, 화력 {mix_values['fossil']}%",
                "grid_stability": grid["label"],
                "carbon_emissions": carbon_round,
                "best_source": best_source,
            }
            final_state = await agent_app.ainvoke(initial_state)
            ai_msg = final_state.get("ai_message") or ai_msg
        except Exception as e:
            print(f"Agent Error: {e}")

    return {
        # --- 기존 필드 (하위 호환: 프론트엔드 수정 없이 그대로 동작) ---
        "carbon_emissions": carbon_round,
        "sustainability_score": round(analysis["score"], 1),
        "suitability": analysis["sim"]["suitability"],
        "ai_message": ai_msg,
        "current_region": mix.region,
        "grid_stability": grid["label"],
        "weather_info": weather,
        # --- Confidence 신규 필드 ---
        "goal": analysis["goal"],
        "level": analysis["level"],
        "factors": analysis["factors"],
        "next_action": analysis["next_action"],
        "grid": grid,
        "mix_used": {k: round(v, 1) for k, v in mix_values.items()},
        "projection": analysis["projection"],
    }


@app.post("/calculate")
async def calculate_impact(mix: EnergyMix, db: Session = Depends(get_db)):
    return await run_simulation(mix, db)


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
