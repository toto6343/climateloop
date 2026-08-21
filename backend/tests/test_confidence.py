"""Confidence(자신감) 개선 검증 테스트.

pytest 없이도 돌아간다:
    cd backend && python tests/test_confidence.py
pytest가 있으면 그대로 수집된다:
    cd backend && python -m pytest tests/test_confidence.py -v

LLM은 호출하지 않는다 (CLIMATELOOP_DISABLE_AI=1을 임포트 전에 설정).
"""

import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
# SQLite 경로가 CWD 기준 상대경로("sqlite:///./data/climateloop.db")라 backend/에서 돌아야 한다
os.chdir(BACKEND_DIR)
os.environ["CLIMATELOOP_DISABLE_AI"] = "1"

import main  # noqa: E402
from main import (  # noqa: E402
    CARBON_BEST, CARBON_WORST, EFF_KEYS, FACTOR_WEIGHTS, GOAL_TARGET, GRID_RANK,
    HYDRO_BASE_INDEX, MIX_KEYS, REGION_FACTOR_AVERAGE,
    GENERATION_SCALE, PROGRESS_LEVELS, PROJECTION_STEPS, WEATHER_PROFILES, analyze,
    build_grid, build_projection, build_scenario_comparison, build_suitability_basis, composite_score,
    estimate_generation, evaluate_goal, evaluate_level, normalize_mix, redistribute,
    score_factors, simulate,
)

def _seeded_factors(region: str) -> dict:
    """DB 에 적재된 그 지역의 계수 4개.

    값을 여기 하드코딩해 두었더니 계수의 출처가 바뀔 때마다 테스트가 함께 썩었다
    (화력이 내장 표 → EPSIS 설비용량으로 바뀌면서 제주 0.40 → 0.71). 이 테스트들이
    검증하려는 것은 "엔드포인트가 산출식과 같은 값을 내놓는가"이고 계수 자체의
    값이 아니다. 그러니 계수는 화면과 같은 곳에서 읽어 온다 — 그러면 seed 를
    다시 돌려 값이 바뀌어도 이 파일은 고칠 필요가 없다.
    """
    import sqlite3
    conn = sqlite3.connect(os.path.join(BACKEND_DIR, "data", "climateloop.db"))
    try:
        rows = conn.execute(
            "SELECT source, efficiency_score FROM energy_efficiency WHERE region = ?",
            (region,),
        ).fetchall()
    finally:
        conn.close()
    factors = {source: score for source, score in rows}
    assert set(factors) == set(EFF_KEYS), f"{region} 계수가 모자랍니다: {sorted(factors)}"
    return factors


SEOUL = _seeded_factors("서울")
JEONNAM = _seeded_factors("전남")
JEJU = _seeded_factors("제주")
CLEAR = WEATHER_PROFILES["맑음"]
TYPHOON = WEATHER_PROFILES["태풍"]


def mix(renewable, nuclear, fossil):
    return {"renewable": renewable, "nuclear": nuclear, "fossil": fossil}


# ---------------------------------------------------------------------------
# 순수 계산부
# ---------------------------------------------------------------------------

def test_simulate_matches_legacy_formula():
    """적합도·수요·계획 배출강도는 기존 계산식 그대로인지 (하위 호환).

    carbon 은 기상까지 반영하도록 확장됐으므로 여기서 검증하지 않는다.
    기존 공식은 carbon_planned 로 이름을 얻어 남아 있다.
    """
    m = mix(33.3, 33.3, 33.4)
    sim = simulate(m, SEOUL, CLEAR)

    expected_planned = (33.3 * 12 + 33.3 * 12 + 33.4 * 650) / 100
    assert abs(sim["carbon_planned"] - expected_planned) < 1e-9
    # 계수는 SEOUL 픽스처(=DB 적재값)에서 가져온다. 숫자를 박아 두면 계수 출처가
    # 바뀔 때 식이 아니라 값 때문에 깨진다 — 이 테스트가 지키는 것은 식의 모양이다.
    assert abs(sim["final_solar"] - 33.3 * SEOUL["solar"] * CLEAR["solar_mult"]) < 1e-9
    assert abs(sim["demand"] - 100.0) < 1e-9
    assert set(sim["suitability"]) == {"태양광", "풍력", "수력", "화력"}
    assert all(v <= 100 for v in sim["suitability"].values())


# ---------------------------------------------------------------------------
# 기상 → 적합도 → 배출량 파이프라인
#
# 배출강도가 믹스만 보고 계산되던 동안에는 기후 시나리오를 바꿔도 탄소 수치가
# 꼼짝하지 않았다. 아래 테스트들이 그 연결을 고정한다.
# ---------------------------------------------------------------------------

def test_carbon_follows_the_delivered_generation_mix():
    """배출강도 = 실제 발전 구성의 가중평균 (계획 비중이 아니라)."""
    m = mix(33.3, 33.3, 33.4)
    sim = simulate(m, SEOUL, TYPHOON)

    delivered = sim["delivered"]
    expected = (delivered["renewable"] * 12 + delivered["nuclear"] * 12
                + delivered["fossil"] * 650) / sum(delivered.values())

    assert abs(sim["carbon"] - expected) < 1e-9
    # 합계는 기존 production 식과 같은 값이어야 한다 (전력망 판정과 같은 벡터)
    assert abs(sum(delivered.values()) - sim["production"]) < 1e-9


def test_weather_changes_carbon_with_the_mix_held_fixed():
    """같은 믹스인데 기후 시나리오만 바꾸면 배출강도가 달라져야 한다."""
    m = mix(50, 25, 25)
    carbons = {name: simulate(m, JEONNAM, profile)["carbon"]
               for name, profile in WEATHER_PROFILES.items()}

    assert len(set(round(c, 3) for c in carbons.values())) > 1, (
        f"기후를 바꿨는데 배출량이 전부 같다: {carbons}")
    # 태풍은 풍력이 멈추고 태양광도 10%만 남는다 → 인도 전력에서 화력 비중이 올라간다
    assert carbons["태풍"] > carbons["맑음"], carbons


def test_carbon_stays_within_factor_bounds_everywhere():
    """가중평균이므로 어떤 조합에서도 계수 범위를 벗어나지 않는다.

    벗어나면 carbon_score 가 0~100 밖으로 나가 점수 체계가 깨진다.
    """
    for eff in (SEOUL, JEONNAM, JEJU):
        for weather in WEATHER_PROFILES.values():
            for fossil in range(0, 101, 10):
                for nuclear in range(0, 101 - fossil, 10):
                    m = mix(100 - fossil - nuclear, nuclear, fossil)
                    carbon = simulate(m, eff, weather)["carbon"]
                    assert CARBON_BEST - 1e-9 <= carbon <= CARBON_WORST + 1e-9, (m, carbon)


def test_carbon_free_mix_stays_clean_in_every_weather():
    """무탄소 100%면 기상이 어떻든 배출강도는 최저값이다.

    태풍에 재생 100%면 전력이 모자라지만, 인도된 전력 자체는 깨끗하다.
    부족분은 grid 요인이 벌점으로 다룬다 — 두 관심사를 섞지 않는다.
    """
    for weather in WEATHER_PROFILES.values():
        for m in (mix(100, 0, 0), mix(0, 100, 0), mix(50, 50, 0)):
            assert abs(simulate(m, JEJU, weather)["carbon"] - CARBON_BEST) < 1e-9, (m, weather)


def test_scenario_comparison_covers_every_scenario_once():
    rows = build_scenario_comparison(mix(40, 30, 30), SEOUL, "태풍")

    assert [r["scenario"] for r in rows] == list(WEATHER_PROFILES)
    assert sum(r["is_current"] for r in rows) == 1
    assert next(r for r in rows if r["is_current"])["scenario"] == "태풍"
    for row in rows:
        assert row["grid_status"] in GRID_RANK
        assert CARBON_BEST - 1e-9 <= row["carbon_emissions"] <= CARBON_WORST + 1e-9


def test_scenario_comparison_current_row_matches_headline_number():
    """강조된 막대와 화면 대표 수치가 어긋나면 비교 그래프가 거짓말을 한다."""
    client = _client()
    for region, scenario in (("서울", "맑음"), ("전남", "태풍"), ("제주", "겨울"), ("충남", "흐림/비")):
        body = client.post("/calculate", json={
            "renewable": 45, "nuclear": 25, "fossil": 30,
            "region": region, "weather_scenario": scenario, "include_ai": False,
        }).json()

        current = next(r for r in body["carbon_by_scenario"] if r["is_current"])
        assert current["scenario"] == scenario
        assert current["carbon_emissions"] == body["carbon_emissions"], (region, scenario)
        assert body["projection"][0]["carbon_emissions"] == body["carbon_emissions"]


def test_scenario_comparison_marks_fallback_scenario_as_current():
    """알 수 없는 시나리오는 맑음으로 떨어지고, 강조도 맑음에 붙어야 한다."""
    body = _client().post("/calculate", json={
        "renewable": 40, "nuclear": 30, "fossil": 30,
        "weather_scenario": "폭염주의보", "include_ai": False,
    }).json()

    current = next(r for r in body["carbon_by_scenario"] if r["is_current"])
    assert current["scenario"] == "맑음"
    assert current["carbon_emissions"] == body["carbon_emissions"]


def test_scenario_comparison_holds_the_mix_fixed():
    """비교의 전제는 '믹스 고정'이다. 계획 배출강도는 네 행에서 모두 같다."""
    m = mix(60, 20, 20)
    planned = {name: simulate(m, JEONNAM, profile)["carbon_planned"]
               for name in WEATHER_PROFILES
               for profile in [WEATHER_PROFILES[name]]}
    assert len(set(round(v, 9) for v in planned.values())) == 1


def test_calculate_exposes_planned_carbon_for_the_connector_line():
    body = _client().post("/calculate", json={
        "renewable": 60, "nuclear": 20, "fossil": 20,
        "region": "전남", "weather_scenario": "태풍", "include_ai": False,
    }).json()

    expected_planned = (60 * 12 + 20 * 12 + 20 * 650) / 100
    assert abs(body["carbon_planned"] - expected_planned) < 0.01
    # 태풍이라 실제 배출강도는 계획보다 높다
    assert body["carbon_emissions"] > body["carbon_planned"]


def test_suitability_basis_reproduces_every_suitability_value():
    """화면의 "선정 근거" 토글이 적합도 계산을 그대로 재현할 수 있어야 한다.

    토글은 적합도 숫자를 서술만 하지 않고 `화석연료 35% × 서울 화력 계수 1.30 = 45`
    처럼 식을 펼쳐 보여준다. 그 식이 옆의 값과 어긋나면 근거가 근거를 반박하는
    화면이 되므로, 응답의 재료(suitability_basis)와 믹스·기상 배수만으로 네 값이
    모두 복원되는지 고정한다.
    """
    body = _client().post("/calculate", json={
        "renewable": 40, "nuclear": 25, "fossil": 35,
        "region": "서울", "weather_scenario": "겨울", "include_ai": False,
    }).json()

    basis = body["suitability_basis"]
    region_factors = basis["region_factors"]
    mix_used, weather, suitability = body["mix_used"], body["weather_info"], body["suitability"]

    expected = {
        "태양광": mix_used["renewable"] * region_factors["solar"] * weather["solar_mult"],
        "풍력": mix_used["renewable"] * region_factors["wind"] * weather["wind_mult"],
        # 수력만 믹스·기상과 무관한 고정 지수다
        "수력": basis["hydro_base_index"] * region_factors["hydro"],
        "화력": mix_used["fossil"] * region_factors["thermal"],
    }
    for source, raw in expected.items():
        assert abs(suitability[source] - min(100.0, raw)) < 0.05, source


def test_suitability_basis_falls_back_to_national_average():
    """계수가 없는 지역이 와도 프론트가 결측을 다루지 않게 평균으로 채운다."""
    basis = build_suitability_basis({})
    assert basis["region_factors"] == {key: REGION_FACTOR_AVERAGE for key in EFF_KEYS}
    assert basis["hydro_base_index"] == HYDRO_BASE_INDEX


def test_hydro_index_stays_at_the_legacy_constant():
    """수력 기준 지수는 이름만 얻었고 값은 종전(45)과 같아야 한다."""
    assert HYDRO_BASE_INDEX == 45.0
    sim = simulate(mix(33.3, 33.3, 33.4), SEOUL, CLEAR)
    assert abs(sim["suitability"]["수력"] - 45.0 * SEOUL["hydro"]) < 1e-9


def test_carbon_factor_detail_explains_the_weather_effect():
    """왜 이 점수인가요 카드가 기상 영향을 설명할 수 있어야 한다."""
    m = mix(60, 20, 20)
    factors = score_factors(simulate(m, JEONNAM, TYPHOON), m, JEONNAM, TYPHOON, "전남")
    detail = next(f for f in factors if f["key"] == "carbon")["detail"]
    assert "믹스 자체는" in detail

    calm = score_factors(simulate(m, JEONNAM, CLEAR), m, JEONNAM, CLEAR, "전남")
    calm_detail = next(f for f in calm if f["key"] == "carbon")["detail"]
    assert "gCO2/kWh" in calm_detail


def test_carbon_factor_spans_full_range():
    """화력 100% → 0점, 무탄소 100% → 100점."""
    worst = score_factors(simulate(mix(0, 0, 100), SEOUL, CLEAR), mix(0, 0, 100), SEOUL, CLEAR, "서울")
    best = score_factors(simulate(mix(0, 100, 0), SEOUL, CLEAR), mix(0, 100, 0), SEOUL, CLEAR, "서울")

    carbon_worst = next(f for f in worst if f["key"] == "carbon")
    carbon_best = next(f for f in best if f["key"] == "carbon")

    assert abs(carbon_worst["score"] - 0.0) < 0.1
    assert abs(carbon_best["score"] - 100.0) < 0.1


def test_factor_weights_sum_to_one():
    assert abs(sum(FACTOR_WEIGHTS.values()) - 1.0) < 1e-9


def test_score_is_bounded_across_many_mixes():
    """어떤 믹스·지역·날씨 조합에서도 0~100을 벗어나지 않는다."""
    for eff in (SEOUL, JEONNAM):
        for weather in WEATHER_PROFILES.values():
            for fossil in range(0, 101, 10):
                for nuclear in range(0, 101 - fossil, 10):
                    m = mix(100 - fossil - nuclear, nuclear, fossil)
                    score, _, factors = main._evaluate(m, eff, weather, "테스트")
                    assert 0.0 <= score <= 100.0, (m, score)
                    for f in factors:
                        assert 0.0 <= f["score"] <= 100.0, (m, f)


def test_more_fossil_lowers_score():
    """화력을 늘리면 점수가 떨어진다 (단조성)."""
    previous = None
    for fossil in range(0, 101, 10):
        renewable = (100 - fossil) / 2
        score, _, _ = main._evaluate(mix(renewable, renewable, fossil), SEOUL, CLEAR, "서울")
        if previous is not None:
            assert score <= previous + 1e-9, f"화력 {fossil}%에서 점수가 올랐다"
        previous = score


def test_regional_fit_rewards_matching_region():
    """같은 믹스라도 재생 여건이 좋은 지역에서 적합도가 높다."""
    m = mix(80, 10, 10)
    seoul_fit = next(f for f in score_factors(simulate(m, SEOUL, CLEAR), m, SEOUL, CLEAR, "서울")
                     if f["key"] == "fit")
    jeonnam_fit = next(f for f in score_factors(simulate(m, JEONNAM, CLEAR), m, JEONNAM, CLEAR, "전남")
                       if f["key"] == "fit")
    assert jeonnam_fit["score"] > seoul_fit["score"]


def test_typhoon_hurts_grid_when_renewable_heavy():
    """태풍(풍력 정지)에 재생 편중이면 전력망 점수가 떨어진다.

    재생 60% 를 쓴다(전에는 90% 였다). 지역 계수가 공표 설비용량 기반으로 바뀌면서
    전남의 태양광·풍력 계수가 2.00 / 1.95 로 올라, 재생 70% 이상에서는 **맑음 쪽이
    이미 공급 과잉 상한에 걸려** 점수가 0 이 된다(마진 +82). 그 상태에서 태풍(0)과
    비교하면 "떨어졌다"가 아니라 "두 극단이 같다"를 확인하는 셈이 된다.
    60% 는 맑음이 아직 정상 범위(19.0)에 있어 태풍의 하락이 점수로 드러난다.

    공급 마진도 함께 본다. 점수는 상·하한에 걸리면 정보를 잃지만 마진은 그렇지
    않으므로, 계수가 또 바뀌어도 "태풍이 공급을 깎는다"는 인과는 이쪽이 지킨다.
    """
    m = mix(60, 20, 20)
    clear_sim = simulate(m, JEONNAM, CLEAR)
    typhoon_sim = simulate(m, JEONNAM, TYPHOON)

    clear_grid = next(f for f in score_factors(clear_sim, m, JEONNAM, CLEAR, "전남")
                      if f["key"] == "grid")
    typhoon_grid = next(f for f in score_factors(typhoon_sim, m, JEONNAM, TYPHOON, "전남")
                        if f["key"] == "grid")
    assert typhoon_grid["score"] < clear_grid["score"]
    assert build_grid(typhoon_sim)["margin"] < build_grid(clear_sim)["margin"]


def test_penalty_and_contribution_add_up():
    """contribution + penalty = 가중치 × 100."""
    m = mix(40, 30, 30)
    factors = score_factors(simulate(m, SEOUL, CLEAR), m, SEOUL, CLEAR, "서울")
    for f in factors:
        assert abs(f["contribution"] + f["penalty"] - f["weight"] * 100.0) < 0.2


# ---------------------------------------------------------------------------
# 목표 / 레벨
# ---------------------------------------------------------------------------

def test_goal_reports_gap_and_progress():
    goal = evaluate_goal(62.4)
    assert goal["target"] == GOAL_TARGET
    assert goal["achieved"] is False
    assert abs(goal["gap"] - 7.6) < 0.05
    assert 0 < goal["progress_pct"] < 100

    reached = evaluate_goal(85.0)
    assert reached["achieved"] is True
    assert reached["gap"] == 0.0
    assert reached["progress_pct"] == 100.0


def test_level_boundaries():
    assert evaluate_level(0.0)["current"]["id"] == 1
    assert evaluate_level(39.9)["current"]["id"] == 1
    assert evaluate_level(40.0)["current"]["id"] == 2
    assert evaluate_level(70.0)["current"]["id"] == 3
    assert evaluate_level(85.0)["current"]["id"] == 4
    assert evaluate_level(100.0)["next"] is None


def test_level_to_next_is_positive():
    level = evaluate_level(55.0)
    assert level["next"]["id"] == 3
    assert abs(level["to_next"] - 15.0) < 0.05


def test_goal_target_matches_a_level_boundary():
    """목표 점수가 레벨 경계와 어긋나면 UI에서 모순된 메시지가 나온다."""
    assert GOAL_TARGET in [l["min_score"] for l in PROGRESS_LEVELS]


# ---------------------------------------------------------------------------
# 다음 행동 제안 (통제감)
# ---------------------------------------------------------------------------

def test_redistribute_keeps_total_100():
    for lever in MIX_KEYS:
        result = redistribute(mix(33.3, 33.3, 33.4), lever, 60.0)
        assert abs(sum(result.values()) - 100.0) < 1e-9
        assert abs(result[lever] - 60.0) < 1e-9


def test_redistribute_handles_zero_others():
    result = redistribute(mix(100.0, 0.0, 0.0), "renewable", 40.0)
    assert abs(sum(result.values()) - 100.0) < 1e-9
    assert abs(result["nuclear"] - 30.0) < 1e-9
    assert abs(result["fossil"] - 30.0) < 1e-9


def test_redistribute_revives_zero_axis_when_share_is_returned():
    """0%인 축도 lever를 내리면 다시 자란다.

    순수 비율만 쓰면 0/current 가 영원히 0이라, 한 번 0이 된 축은 슬라이더로
    되살릴 방법이 없었다(0%에 영구 고정).
    """
    result = redistribute(mix(50.0, 50.0, 0.0), "renewable", 40.0)
    assert abs(sum(result.values()) - 100.0) < 1e-9
    assert result["fossil"] > 0.0


def test_redistribute_keeps_zero_axis_at_zero_when_share_shrinks():
    """반대로 lever를 올릴 때는 0%인 축을 되살리지 않는다.

    여기서 화석이 되살아나면 '재생을 올렸는데 배출량이 는다'가 되어
    build_projection 의 단조 감소 약속이 깨진다.
    """
    result = redistribute(mix(50.0, 50.0, 0.0), "renewable", 60.0)
    assert result["fossil"] == 0.0
    assert abs(result["nuclear"] - 40.0) < 1e-9


def test_redistribute_does_not_fully_skew_on_tiny_other_total():
    """나머지 두 축의 합이 아주 작아도 한쪽으로 전부 쏠리지 않는다."""
    result = redistribute(mix(99.8, 0.2, 0.0), "renewable", 50.0)
    assert abs(sum(result.values()) - 100.0) < 1e-9
    assert min(result["nuclear"], result["fossil"]) > 1.0


def test_next_action_promise_is_reproducible():
    """제안한 resulting_mix를 실제로 적용하면 expected_score가 나와야 한다.

    이게 깨지면 [적용] 버튼이 약속을 어기게 되고, Confidence 설계가 무너진다.
    """
    checked = 0
    for eff, region in ((SEOUL, "서울"), (JEONNAM, "전남")):
        for weather in WEATHER_PROFILES.values():
            for fossil in (10, 30, 50, 70, 90):
                m = mix((100 - fossil) / 2, (100 - fossil) / 2, fossil)
                result = analyze(m, eff, weather, region)
                action = result["next_action"]
                if action is None:
                    continue
                replayed, _, _ = main._evaluate(action["resulting_mix"], eff, weather, region)
                assert abs(replayed - action["expected_score"]) < 0.2, (
                    region, weather["msg"], m, action["expected_score"], replayed)
                assert action["expected_gain"] > 0
                checked += 1
    assert checked > 10, "검증한 제안이 너무 적다"


def test_next_action_absent_at_optimum():
    """더 나아질 여지가 없으면 제안하지 않는다 (거짓 희망 방지)."""
    result = analyze(mix(0, 100, 0), SEOUL, TYPHOON, "서울")
    action = result["next_action"]
    if action is not None:
        assert action["expected_gain"] > 0


def test_jeju_typhoon_does_not_recommend_cutting_fossil():
    """제주/태풍/재생85·원자력10·화력5.

    공급 21 vs 수요 120인 정전 위험 상태다. 여기서 화력을 더 줄이라는 제안은
    탄소는 개선해도 정전을 악화시키므로 나오면 안 된다.
    """
    m = mix(85, 10, 5)
    result = analyze(m, JEJU, TYPHOON, "제주")

    assert result["grid"]["status"] == "deficit", "전제 조건: 공급 부족 상태여야 한다"

    action = result["next_action"]
    assert action is not None, "대안이 아예 없으면 학습자가 막힌다"
    assert not (action["lever"] == "fossil" and action["delta"] < 0), (
        f"공급 부족 상태에서 화력 감축을 제안했다: {action['lever']} {action['delta']}%p")
    assert action["grid_margin_change"] >= 0, (
        f"공급 여유가 줄어드는 제안이다: {action['grid_margin_change']}")


def test_deficit_never_gets_supply_reducing_advice():
    """공급 부족 상태 전반에 대한 불변식 (요건 1)."""
    checked = 0
    for eff, region in ((SEOUL, "서울"), (JEONNAM, "전남"), (JEJU, "제주")):
        for weather in WEATHER_PROFILES.values():
            for renewable in range(0, 101, 10):
                for nuclear in range(0, 101 - renewable, 20):
                    m = mix(renewable, nuclear, 100 - renewable - nuclear)
                    result = analyze(m, eff, weather, region)
                    if result["grid"]["status"] != "deficit":
                        continue
                    action = result["next_action"]
                    if action is None:
                        continue
                    assert action["grid_margin_change"] >= -0.01, (
                        region, weather["msg"], m, action["lever"], action["delta"],
                        action["grid_margin_change"])
                    checked += 1
    assert checked > 20, f"검증한 공급부족 케이스가 너무 적다 ({checked})"


def test_next_action_never_downgrades_grid_status():
    """어떤 상태에서든 전력망 등급을 떨어뜨리는 제안은 하지 않는다 (요건 2)."""
    checked = 0
    for eff, region in ((SEOUL, "서울"), (JEONNAM, "전남"), (JEJU, "제주")):
        for weather in WEATHER_PROFILES.values():
            for fossil in range(0, 101, 10):
                m = mix((100 - fossil) / 2, (100 - fossil) / 2, fossil)
                result = analyze(m, eff, weather, region)
                action = result["next_action"]
                if action is None:
                    continue
                before = GRID_RANK[result["grid"]["status"]]
                after = GRID_RANK[action["resulting_grid_status"]]
                assert after >= before, (
                    region, weather["msg"], m,
                    result["grid"]["status"], "->", action["resulting_grid_status"])
                checked += 1
    assert checked > 30, f"검증한 케이스가 너무 적다 ({checked})"


def test_grid_recovery_is_preferred_over_marginal_score_gain():
    """전력망 등급을 회복시키는 후보가 있으면 그쪽을 고른다 (요건 2)."""
    found = False
    for eff, region in ((SEOUL, "서울"), (JEONNAM, "전남"), (JEJU, "제주")):
        for weather in WEATHER_PROFILES.values():
            for fossil in range(0, 101, 10):
                m = mix((100 - fossil) / 2, (100 - fossil) / 2, fossil)
                result = analyze(m, eff, weather, region)
                action = result["next_action"]
                if action is None or result["grid"]["status"] != "deficit":
                    continue
                if action["resulting_grid_status"] != "deficit":
                    # 등급 회복 후보를 골랐다면 공급도 늘어야 한다
                    assert action["grid_margin_change"] > 0
                    found = True
    assert found, "등급 회복 사례를 한 건도 만들지 못했다 (탐색 범위 점검 필요)"


def test_next_action_still_reproducible_after_grid_guard():
    """가드 추가 후에도 약속한 점수가 재현되는지 (기존 보장 유지)."""
    m = mix(85, 10, 5)
    action = analyze(m, JEJU, TYPHOON, "제주")["next_action"]
    replayed, _, _ = main._evaluate(action["resulting_mix"], JEJU, TYPHOON, "제주")
    assert abs(replayed - action["expected_score"]) < 0.2


def test_next_action_reason_has_no_placeholder():
    result = analyze(mix(20, 20, 60), JEONNAM, CLEAR, "전남")
    action = result["next_action"]
    assert action is not None
    assert "{" not in action["reason"] and "}" not in action["reason"]
    assert action["primary_factor"] in FACTOR_WEIGHTS


# ---------------------------------------------------------------------------
# 배출 시뮬레이션 곡선 (projection)
# ---------------------------------------------------------------------------

def test_projection_shape():
    """현재(0) + PROJECTION_STEPS 순서로 나온다."""
    points = build_projection(mix(30, 30, 40), JEONNAM, CLEAR)
    assert [p["step"] for p in points] == [0] + list(PROJECTION_STEPS)
    for p in points:
        assert set(p) == {"step", "renewable", "carbon_emissions", "clamped"}
        # 라벨 문자열은 백엔드가 만들지 않는다 (표현은 프론트 몫)
        assert not any(isinstance(v, str) for v in p.values())


def test_projection_first_point_matches_current():
    """0단계는 현재 믹스의 배출량과 같아야 한다."""
    m = mix(30, 30, 40)
    sim = simulate(m, JEONNAM, CLEAR)
    points = build_projection(m, JEONNAM, CLEAR)
    assert abs(points[0]["carbon_emissions"] - round(sim["carbon"], 2)) < 0.01
    assert abs(points[0]["renewable"] - m["renewable"]) < 0.05
    assert points[0]["clamped"] is False


def test_projection_matches_endpoint_carbon():
    """응답의 projection[0]이 carbon_emissions와 일치해야 차트 기준선이 맞다."""
    body = {"renewable": 30, "nuclear": 30, "fossil": 40, "region": "전남", "include_ai": False}
    d = _client().post("/calculate", json=body).json()
    assert d["projection"][0]["carbon_emissions"] == d["carbon_emissions"]
    assert abs(d["projection"][0]["renewable"] - d["mix_used"]["renewable"]) < 0.05


def test_projection_reproduces_actual_calculation():
    """각 지점이 그 믹스로 실제 요청했을 때의 배출량과 같아야 한다.

    차트가 약속한 값과 사용자가 슬라이더로 도달하는 값이 어긋나면 안 된다.
    """
    client = _client()
    for region, weather_id in (("전남", "맑음"), ("서울", "겨울"), ("제주", "태풍")):
        base = mix(30, 30, 40)
        body = {**base, "region": region, "weather_scenario": weather_id, "include_ai": False}
        points = client.post("/calculate", json=body).json()["projection"]

        for point in points[1:]:
            replay = client.post("/calculate", json={
                **redistribute(base, "renewable", point["renewable"]),
                "region": region, "weather_scenario": weather_id, "include_ai": False,
            }).json()
            assert abs(replay["carbon_emissions"] - point["carbon_emissions"]) < 0.05, (
                region, weather_id, point)


def test_projection_carbon_is_non_increasing():
    """재생 비중이 오르면 배출량이 늘어나지 않는다."""
    for eff, region in ((SEOUL, "서울"), (JEONNAM, "전남"), (JEJU, "제주")):
        for weather in WEATHER_PROFILES.values():
            for fossil in range(0, 101, 20):
                m = mix((100 - fossil) / 2, (100 - fossil) / 2, fossil)
                points = build_projection(m, eff, weather)
                for prev, cur in zip(points, points[1:]):
                    assert cur["carbon_emissions"] <= prev["carbon_emissions"] + 1e-9, (region, m)
                    assert cur["renewable"] >= prev["renewable"] - 1e-9


def test_projection_flags_clamped_points():
    """재생 100% 상한에 걸린 지점은 clamped로 표시한다."""
    points = build_projection(mix(85, 10, 5), JEJU, CLEAR)
    assert points[0]["clamped"] is False
    assert points[1]["clamped"] is False          # 85 + 10 = 95
    assert points[2]["clamped"] is True           # 85 + 20 -> 100
    assert points[3]["clamped"] is True           # 85 + 30 -> 100
    assert points[2]["renewable"] == 100.0
    assert points[3]["carbon_emissions"] == points[2]["carbon_emissions"]


def test_projection_no_clamp_when_headroom_exists():
    points = build_projection(mix(10, 40, 50), SEOUL, CLEAR)
    assert all(p["clamped"] is False for p in points)
    assert [p["renewable"] for p in points] == [10.0, 20.0, 30.0, 40.0]


# ---------------------------------------------------------------------------
# 정규화
# ---------------------------------------------------------------------------

def test_normalize_leaves_valid_mix_untouched():
    m = mix(33.3, 33.3, 33.4)
    assert normalize_mix(m) == m


def test_normalize_fixes_bad_total():
    result = normalize_mix(mix(50, 50, 50))
    assert abs(sum(result.values()) - 100.0) < 1e-9
    assert abs(result["renewable"] - 33.333333) < 1e-4


def test_normalize_handles_all_zero():
    result = normalize_mix(mix(0, 0, 0))
    assert abs(sum(result.values()) - 100.0) < 1e-9


# ---------------------------------------------------------------------------
# API 계약
# ---------------------------------------------------------------------------

def _client():
    from fastapi.testclient import TestClient
    return TestClient(main.app)


def test_calculate_keeps_legacy_fields():
    """프론트엔드를 수정하지 않아도 동작해야 한다."""
    response = _client().post("/calculate", json={
        "renewable": 33.3, "nuclear": 33.3, "fossil": 33.4,
        "region": "서울", "weather_scenario": "맑음", "include_ai": False,
    })
    assert response.status_code == 200
    body = response.json()
    for key in ("carbon_emissions", "sustainability_score", "suitability",
                "ai_message", "current_region", "grid_stability", "weather_info"):
        assert key in body, f"기존 필드 {key} 가 사라졌다"
    # 라벨은 있고 비어 있지만 않으면 된다. 내용은 검증하지 않는다 —
    # 사람이 읽는 UI 문구라 언제든 다듬을 수 있어야 하고, 여기에 문자열
    # assert 를 걸면 문구를 고칠 때마다 테스트가 함께 깨진다.
    assert isinstance(body["grid_stability"], str)
    assert body["grid_stability"], "라벨이 비면 화면에 표시할 것이 없다"

    # 상태 판정은 문자열을 쪼개는 대신 enum 으로 확인한다.
    assert body["grid"]["status"] in ("deficit", "stable", "surplus")
    # 구 필드가 신 구조와 같은 값을 가리키는지만 고정한다 (문구 무관).
    assert body["grid_stability"] == body["grid"]["label"]


def test_calculate_returns_confidence_fields():
    response = _client().post("/calculate", json={
        "renewable": 20, "nuclear": 20, "fossil": 60,
        "region": "전남", "weather_scenario": "맑음", "include_ai": False,
    })
    assert response.status_code == 200
    body = response.json()

    for key in ("goal", "level", "factors", "next_action", "grid", "mix_used"):
        assert key in body, f"신규 필드 {key} 누락"

    assert body["goal"]["target"] == GOAL_TARGET
    assert body["level"]["current"]["id"] >= 1
    assert len(body["factors"]) == 3
    assert {f["key"] for f in body["factors"]} == {"carbon", "grid", "fit"}
    assert body["grid"]["status"] in ("deficit", "stable", "surplus")
    assert abs(sum(body["mix_used"].values()) - 100.0) < 0.5

    # 총점 = 요인 가중합
    assert abs(sum(f["contribution"] for f in body["factors"])
               - body["sustainability_score"]) < 0.3


def test_calculate_score_equals_goal_current():
    response = _client().post("/calculate", json={
        "renewable": 50, "nuclear": 25, "fossil": 25, "include_ai": False,
    })
    body = response.json()
    assert body["sustainability_score"] == body["goal"]["current"]


def test_calculate_without_ai_still_explains():
    """LLM 없이도 목표·다음 행동이 담긴 문장이 나온다."""
    response = _client().post("/calculate", json={
        "renewable": 10, "nuclear": 10, "fossil": 80, "include_ai": False,
    })
    message = response.json()["ai_message"]
    assert "점" in message
    assert len(message) > 20


def test_unknown_region_falls_back():
    response = _client().post("/calculate", json={
        "renewable": 33, "nuclear": 33, "fossil": 34,
        "region": "존재하지않는지역", "include_ai": False,
    })
    assert response.status_code == 200
    assert response.json()["goal"]["target"] == GOAL_TARGET


def test_confidence_levels_endpoint():
    response = _client().get("/confidence/levels")
    assert response.status_code == 200
    body = response.json()
    assert body["target"] == GOAL_TARGET
    assert len(body["levels"]) == len(PROGRESS_LEVELS)
    assert abs(sum(f["weight"] for f in body["factors"]) - 1.0) < 1e-9


def test_carbon_constants_are_consistent():
    assert CARBON_BEST < CARBON_WORST


# ---------------------------------------------------------------------------
# /regions — 지도 마커 크기·원형 차트의 데이터 원본 (추정 발전량)
# ---------------------------------------------------------------------------

def test_estimate_generation_follows_the_documented_formula():
    """산출식이 문서(README·note 필드)와 어긋나면 면책 문구가 거짓말이 된다.

    계수는 JEJU 픽스처(=DB 적재값)에서 가져온다. 여기 숫자를 박아 두면 계수의
    출처가 바뀔 때 식이 아니라 값 때문에 테스트가 깨진다 — 이 테스트가 지키려는
    것은 "곱셈의 항이 문서와 같은가"이고 계수가 얼마인가가 아니다.
    """
    got = estimate_generation(mix(40, 30, 30), JEJU, CLEAR)

    renewable_share, fossil_share = 0.40, 0.30
    assert abs(got["태양광"] - JEJU["solar"] * CLEAR["solar_mult"]
               * renewable_share * GENERATION_SCALE["태양광"]) < 1e-9
    assert abs(got["풍력"] - JEJU["wind"] * CLEAR["wind_mult"]
               * renewable_share * GENERATION_SCALE["풍력"]) < 1e-9
    # 수력만 기상 배수가 없다 — 이 비대칭이 식의 핵심이라 그대로 검증한다.
    assert abs(got["수력"] - JEJU["hydro"]
               * renewable_share * GENERATION_SCALE["수력"]) < 1e-9
    assert abs(got["화력"] - JEJU["thermal"]
               * fossil_share * GENERATION_SCALE["화력"]) < 1e-9


def test_estimate_generation_is_not_capped_at_100():
    """suitability의 0~100 상한을 물려받으면 잠재력 큰 지역이 눌려 보인다."""
    got = estimate_generation(mix(100, 0, 0), JEJU, CLEAR)
    assert got["풍력"] > 100


def test_estimate_generation_zero_when_source_share_is_zero():
    """재생 0%면 재생 3종이, 화석 0%면 화력이 0이어야 한다."""
    no_renewable = estimate_generation(mix(0, 50, 50), JEONNAM, CLEAR)
    assert no_renewable["태양광"] == 0.0
    assert no_renewable["풍력"] == 0.0
    assert no_renewable["수력"] == 0.0, "재생 0%인데 수력이 돌아가면 앞뒤가 맞지 않는다"
    assert no_renewable["화력"] > 0

    no_fossil = estimate_generation(mix(50, 50, 0), JEONNAM, CLEAR)
    assert no_fossil["화력"] == 0.0


def test_regions_endpoint_covers_all_seeded_regions():
    body = _client().post("/regions", json={
        "renewable": 40, "nuclear": 30, "fossil": 30, "weather_scenario": "맑음",
    }).json()

    names = [r["name"] for r in body["regions"]]
    assert len(names) == len(set(names)), "지역이 중복되면 지도에 마커가 겹쳐 그려진다"
    # seed_db.py 가 적재한 17개 시·도
    assert len(names) == 17
    assert {"서울", "전남", "제주"} <= set(names)


def test_regions_total_is_sum_of_its_sources():
    """마커 크기(total)와 원형 차트(sources)가 같은 값을 말해야 한다."""
    body = _client().post("/regions", json={
        "renewable": 40, "nuclear": 30, "fossil": 30, "weather_scenario": "맑음",
    }).json()

    for region in body["regions"]:
        assert abs(region["total_generation"] - sum(region["sources"].values())) < 0.5
        assert region["total_generation"] > 0


def test_regions_matches_the_pure_function():
    """엔드포인트가 estimate_generation() 을 그대로 내보내는지 확인한다.

    화면(마커 크기·원형 차트)이 읽는 값과 테스트가 검증하는 산출식이 같은
    함수에서 나와야, 위의 공식 검증이 실제 응답에 대한 보장이 된다.
    """
    body = {"renewable": 40, "nuclear": 30, "fossil": 30, "weather_scenario": "겨울"}
    regions = {r["name"]: r for r in _client().post("/regions", json=body).json()["regions"]}

    expected = estimate_generation(mix(40, 30, 30), JEJU, WEATHER_PROFILES["겨울"])
    for source, value in expected.items():
        assert abs(regions["제주"]["sources"][source] - value) < 0.05, source


def test_regions_declares_its_unit_and_disclaimer():
    """면책 표기가 응답에서 사라지면 이 값이 통계로 오인된다."""
    body = _client().post("/regions", json={
        "renewable": 40, "nuclear": 30, "fossil": 30,
    }).json()

    assert "추정" in body["unit"]
    assert "MWh" in body["unit"]
    assert "실제 발전량 통계가 아닌" in body["note"]
    # 검증하는 쪽이 값을 눈으로 확인할 수 있어야 한다
    assert body["scale"]["values"] == GENERATION_SCALE


def test_regions_reacts_to_weather():
    """태풍이면 풍력이 멈춘다 — 마커 크기가 기상 시나리오를 따라와야 한다."""
    client = _client()
    base = {"renewable": 60, "nuclear": 20, "fossil": 20}
    clear = {r["name"]: r for r in client.post(
        "/regions", json={**base, "weather_scenario": "맑음"}).json()["regions"]}
    typhoon = {r["name"]: r for r in client.post(
        "/regions", json={**base, "weather_scenario": "태풍"}).json()["regions"]}

    assert typhoon["제주"]["sources"]["풍력"] == 0.0
    assert typhoon["제주"]["total_generation"] < clear["제주"]["total_generation"]


# ---------------------------------------------------------------------------

def _run():
    tests = [(name, obj) for name, obj in sorted(globals().items())
             if name.startswith("test_") and callable(obj)]
    failures = []
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception as exc:
            failures.append((name, exc))
            print(f"  FAIL  {name}: {type(exc).__name__}: {exc}")

    print(f"\n{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run())
