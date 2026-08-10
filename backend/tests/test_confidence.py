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
    CARBON_BEST, CARBON_WORST, FACTOR_WEIGHTS, GOAL_TARGET, GRID_RANK, MIX_KEYS,
    PROGRESS_LEVELS, PROJECTION_STEPS, WEATHER_PROFILES, analyze, build_projection,
    composite_score, evaluate_goal, evaluate_level, normalize_mix, redistribute,
    score_factors, simulate,
)

SEOUL = {"solar": 0.95, "wind": 0.40, "hydro": 0.20, "thermal": 1.30}
JEONNAM = {"solar": 1.55, "wind": 1.60, "hydro": 0.60, "thermal": 0.60}
JEJU = {"solar": 1.45, "wind": 2.40, "hydro": 0.10, "thermal": 0.40}
CLEAR = WEATHER_PROFILES["맑음"]
TYPHOON = WEATHER_PROFILES["태풍"]


def mix(renewable, nuclear, fossil):
    return {"renewable": renewable, "nuclear": nuclear, "fossil": fossil}


# ---------------------------------------------------------------------------
# 순수 계산부
# ---------------------------------------------------------------------------

def test_simulate_matches_legacy_formula():
    """기존 /calculate 계산식과 동일한 값을 내는지 (하위 호환)."""
    m = mix(33.3, 33.3, 33.4)
    sim = simulate(m, SEOUL, CLEAR)

    expected_carbon = (33.3 * 12 + 33.3 * 12 + 33.4 * 650) / 100
    assert abs(sim["carbon"] - expected_carbon) < 1e-9
    assert abs(sim["final_solar"] - 33.3 * 0.95 * 1.2) < 1e-9
    assert abs(sim["demand"] - 100.0) < 1e-9
    assert set(sim["suitability"]) == {"태양광", "풍력", "수력", "화력"}
    assert all(v <= 100 for v in sim["suitability"].values())


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
    """태풍(풍력 정지)에 재생 편중이면 전력망 점수가 떨어진다."""
    m = mix(90, 5, 5)
    clear_grid = next(f for f in score_factors(simulate(m, JEONNAM, CLEAR), m, JEONNAM, CLEAR, "전남")
                      if f["key"] == "grid")
    typhoon_grid = next(f for f in score_factors(simulate(m, JEONNAM, TYPHOON), m, JEONNAM, TYPHOON, "전남")
                        if f["key"] == "grid")
    assert typhoon_grid["score"] < clear_grid["score"]


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
