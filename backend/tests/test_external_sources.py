"""외부 연동(기상청·KPX) 검증 — 실데이터 경로와 폴백 경로를 모두 돌려 본다.

pytest 없이도 돌아간다 (test_confidence.py 와 같은 방식):
    cd backend && python tests/test_external_sources.py

실제 상류를 부르지 않는다. 키가 없는 환경(=CI·해커톤 현장)에서도 항상 같은 결과가
나와야 하고, 무엇보다 **"실데이터가 들어왔을 때"를 키 없이 검증할 방법이 필요하다**.
services 계층의 함수만 가짜로 바꿔 끼우고 그 아래(httpx)는 아예 타지 않는다.

여기서 확인하는 것은 두 가지다.
  1. 실데이터가 오면 data_source 가 live 로 바뀌고 각주·기준값도 함께 갈린다
  2. 실데이터가 없거나 반쪽이면 예외 없이 조용히 폴백하고, live 라고 주장하지 않는다
"""

import asyncio
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)
os.environ["CLIMATELOOP_DISABLE_AI"] = "1"

import main  # noqa: E402
from models.database import SessionLocal  # noqa: E402
from services import public_api, weather_api  # noqa: E402
from services.kpx_api import _aggregate_by_source, _match_source, _row_source_and_value  # noqa: E402

RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))


def run(coro):
    return asyncio.run(coro)


class _Stub:
    """services 모듈 자리에 끼우는 가짜. 필요한 함수만 들고 있다."""

    SCALE_TOTAL = 870.0

    def __init__(self, scale=None, factors=None, scenario=None):
        self._scale = scale
        self._factors = factors
        self._scenario = scenario

    async def generation_scale(self):
        return self._scale

    async def region_factors(self):
        return self._factors

    async def recommend_scenario(self, region="서울"):
        return self._scenario


def with_services(kpx=None, kma=None):
    """main 의 services 참조를 잠깐 바꿔 끼운다."""
    original = (main.kpx_api, main.weather_api)
    main.kpx_api, main.weather_api = kpx, kma
    return original


def restore_services(original):
    main.kpx_api, main.weather_api = original


# ---------------------------------------------------------------------------
# 1. 시나리오 판별 규칙 (순수 함수)
# ---------------------------------------------------------------------------

def test_scenario_rules():
    decide = weather_api.decide_scenario
    no_warn = {"storm": False}

    # ① 특보가 가장 세다. 비도 안 오고 영하도 아닌데 강풍 특보면 태풍이다.
    check(
        "특보 발효 시 태풍이 우선한다",
        decide({"precipitation_type": 0, "temperature_c": 15.0}, {"storm": True}) == "태풍",
    )
    # 특보는 실황을 덮는다 — 영하이면서 특보면 겨울이 아니라 태풍.
    check(
        "특보는 기온·강수 판정을 덮는다",
        decide({"precipitation_type": 1, "temperature_c": -5.0}, {"storm": True}) == "태풍",
    )
    # ② 강수형태 > 0
    check(
        "강수형태가 0보다 크면 흐림/비",
        decide({"precipitation_type": 1, "temperature_c": 12.0}, no_warn) == "흐림/비",
    )
    # ②가 ③보다 앞이다 — 눈(PTY=3)이 오는 영하는 흐림/비로 잡힌다(규칙 순서 그대로).
    check(
        "강수 판정이 기온 판정보다 앞선다",
        decide({"precipitation_type": 3, "temperature_c": -3.0}, no_warn) == "흐림/비",
    )
    # ③ 기온 <= 0
    check(
        "영하이면 겨울",
        decide({"precipitation_type": 0, "temperature_c": -1.0}, no_warn) == "겨울",
    )
    check(
        "정확히 0도도 겨울 (<= 0)",
        decide({"precipitation_type": 0, "temperature_c": 0.0}, no_warn) == "겨울",
    )
    # ④ 나머지
    check(
        "그 외는 맑음",
        decide({"precipitation_type": 0, "temperature_c": 21.0}, no_warn) == "맑음",
    )
    # 판별 결과는 항상 WEATHER_PROFILES 의 키여야 한다. 아니면 화면 탭과 못 잇는다.
    every = [
        decide({"precipitation_type": p, "temperature_c": t}, {"storm": s})
        for p in (0, 1, 3) for t in (-5.0, 0.0, 20.0) for s in (True, False)
    ]
    check(
        "판별 결과는 모두 WEATHER_PROFILES 의 키다",
        all(v in main.WEATHER_PROFILES for v in every),
        f"{sorted(set(every))}",
    )


# ---------------------------------------------------------------------------
# 2. 기상청 실황 base_time 계산
# ---------------------------------------------------------------------------

def test_base_time_rolls_back_before_publication():
    from datetime import datetime

    # 초단기실황은 정시 40분경 공개된다. 45분 이전에는 앞 시각을 물어야 한다.
    early = weather_api._base_datetime(datetime(2026, 8, 21, 14, 10))
    late = weather_api._base_datetime(datetime(2026, 8, 21, 14, 50))
    check("공개 전(14:10)에는 13시 실황을 묻는다", early == ("20260821", "1300"), str(early))
    check("공개 후(14:50)에는 14시 실황을 묻는다", late == ("20260821", "1400"), str(late))

    # 자정 직후에는 날짜까지 하루 뒤로 물러나야 한다.
    midnight = weather_api._base_datetime(datetime(2026, 8, 21, 0, 5))
    check("자정 직후에는 전날 23시로 물러난다", midnight == ("20260820", "2300"), str(midnight))


# ---------------------------------------------------------------------------
# 3. KPX 응답 파싱 (필드명을 맞히지 않고 값으로 판별한다)
# ---------------------------------------------------------------------------

def test_fuel_mapping_folds_thermal():
    # 화력 = 유류 + 유연탄 + 가스 + 국내탄
    for fuel in ("유류", "유연탄", "가스", "국내탄", "LNG", "무연탄"):
        check(f"{fuel} → 화력", _match_source(fuel) == "화력", _match_source(fuel))
    check("태양광 → 태양광", _match_source("태양광") == "태양광")
    check("소수력은 수력으로 접힌다", _match_source("소수력") == "수력")
    check("양수는 4종에 넣지 않는다", _match_source("양수") is None, _match_source("양수"))
    check("원자력은 4종에 넣지 않는다", _match_source("원자력") is None, _match_source("원자력"))

    # 꾸밈말이 붙어도 찾는다
    check("'유연탄(발전)' 도 화력", _match_source("유연탄(발전)") == "화력")


def test_row_parsing_ignores_year_and_code_fields():
    # 연도·순번은 숫자여도 발전량이 아니다. 발전량(4321.5)이 골라져야 한다.
    row = {"baseYear": "2026", "seqNo": "7", "fuelType": "유연탄", "genAmount": "4,321.5"}
    source, value = _row_source_and_value(row)
    check("연료명을 값에서 찾아낸다", source == "화력", str(source))
    check("연도·순번을 발전량으로 오인하지 않는다", value == 4321.5, str(value))

    # 연료명이 없으면 아무것도 돌려주지 않는다 (조용히 무시된다)
    check("연료명이 없으면 None", _row_source_and_value({"a": "1", "b": "2"})[0] is None)


def test_aggregate_sums_thermal_across_fuels():
    rows = [
        {"fuel": "태양광", "amt": "10"},
        {"fuel": "풍력", "amt": "20"},
        {"fuel": "수력", "amt": "5"},
        {"fuel": "유류", "amt": "100"},
        {"fuel": "유연탄", "amt": "200"},
        {"fuel": "가스", "amt": "300"},
        {"fuel": "국내탄", "amt": "50"},
        {"fuel": "원자력", "amt": "999"},   # 4종에 없으므로 빠진다
    ]
    got = _aggregate_by_source(rows)["totals"]
    check("화력은 네 연료의 합", got["화력"] == 650.0, str(got["화력"]))
    check("태양광 합계", got["태양광"] == 10.0, str(got["태양광"]))
    check("원자력은 합계에 들어가지 않는다", sum(got.values()) == 685.0, str(sum(got.values())))


# ---------------------------------------------------------------------------
# 4. /regions — 실데이터 경로와 폴백 경로
# ---------------------------------------------------------------------------

LIVE_SCALE = {
    # 실제 응답을 흉내낸 값. 총합은 SCALE_TOTAL(870)과 같게 두었다.
    "scale": {"태양광": 90.0, "풍력": 60.0, "수력": 20.0, "화력": 700.0},
    "ratios": {"태양광": 10.34, "풍력": 6.9, "수력": 2.3, "화력": 80.46},
    "raw_totals": {"태양광": 9.0, "풍력": 6.0, "수력": 2.0, "화력": 70.0},
    "rows_matched": 8,
}


def _regions(weather="맑음"):
    db = SessionLocal()
    try:
        query = main.RegionQuery(renewable=33, nuclear=33, fossil=34, weather_scenario=weather)
        return run(main.region_breakdown(query, db))
    finally:
        db.close()


def test_regions_uses_live_scale_when_available():
    original = with_services(kpx=_Stub(scale=LIVE_SCALE))
    try:
        body = _regions()
    finally:
        restore_services(original)

    check("실데이터가 오면 data_source=live", body["data_source"] == "live", body["data_source"])
    check("기준값이 KPX 구성비로 갈린다", body["scale"]["values"] == LIVE_SCALE["scale"], str(body["scale"]["values"]))
    check("각주가 KPX 문구로 갈린다", "한국전력거래소(KPX)" in body["note"], body["note"][:40])
    check("실데이터일 때 구성비를 함께 공개한다", "live_ratios_pct" in body["scale"])
    check("17개 시·도가 모두 온다", len(body["regions"]) == 17, str(len(body["regions"])))

    # 실데이터를 써도 지역별 값이 서로 다르다 = 지역 계수가 여전히 살아 있다.
    totals = {r["name"]: r["total_generation"] for r in body["regions"]}
    check("실데이터를 써도 지역 간 차이가 남는다", len(set(totals.values())) > 1, str(len(set(totals.values()))))


def test_regions_falls_back_silently():
    for label, stub in (("None 반환", _Stub(scale=None)), ("모듈 자체가 없음", None)):
        original = with_services(kpx=stub)
        try:
            body = _regions()
        finally:
            restore_services(original)

        check(f"폴백({label}): data_source=fallback", body["data_source"] == "fallback", body["data_source"])
        check(f"폴백({label}): 기존 기준값 유지", body["scale"]["values"] == main.GENERATION_SCALE)
        check(f"폴백({label}): 기존 각주 유지", body["note"] == main.GENERATION_NOTE)
        check(f"폴백({label}): live 구성비를 붙이지 않는다", "live_ratios_pct" not in body["scale"])
        check(f"폴백({label}): 17개 시·도가 그대로 온다", len(body["regions"]) == 17)
        # 폴백에서도 값이 비지 않는다 — 화면이 깨지는 경로가 없어야 한다.
        check(
            f"폴백({label}): 모든 지역에 4개 발전원 값이 있다",
            all(set(r["sources"]) == {"태양광", "풍력", "수력", "화력"} for r in body["regions"]),
        )


def test_live_scale_keeps_the_sliders_alive():
    """실데이터를 써도 믹스·기상이 결과를 움직여야 한다.

    KPX 발전량을 결과에 그대로 덮어쓰면 도넛이 조작에 반응하지 않게 된다.
    그건 실데이터 연동이 아니라 기능 제거이므로, 여기서 못을 박아 둔다.
    """
    original = with_services(kpx=_Stub(scale=LIVE_SCALE))
    try:
        clear = _regions("맑음")
        typhoon = _regions("태풍")
    finally:
        restore_services(original)

    seoul_clear = next(r for r in clear["regions"] if r["name"] == "서울")
    seoul_typhoon = next(r for r in typhoon["regions"] if r["name"] == "서울")
    check(
        "실데이터 경로에서도 기후 탭이 발전량을 바꾼다",
        seoul_clear["sources"]["풍력"] != seoul_typhoon["sources"]["풍력"],
        f'{seoul_clear["sources"]["풍력"]} vs {seoul_typhoon["sources"]["풍력"]}',
    )

    # 믹스도 마찬가지.
    original = with_services(kpx=_Stub(scale=LIVE_SCALE))
    try:
        db = SessionLocal()
        try:
            heavy = run(main.region_breakdown(
                main.RegionQuery(renewable=90, nuclear=5, fossil=5, weather_scenario="맑음"), db))
        finally:
            db.close()
    finally:
        restore_services(original)

    seoul_heavy = next(r for r in heavy["regions"] if r["name"] == "서울")
    check(
        "실데이터 경로에서도 믹스 슬라이더가 발전량을 바꾼다",
        seoul_heavy["sources"]["태양광"] != seoul_clear["sources"]["태양광"],
        f'{seoul_heavy["sources"]["태양광"]} vs {seoul_clear["sources"]["태양광"]}',
    )


# ---------------------------------------------------------------------------
# 5. GET /api/weather/scenario
# ---------------------------------------------------------------------------

def test_weather_endpoint_live_and_fallback():
    live = {
        "scenario": "태풍",
        "raw": {
            "observation": {
                "temperature_c": 18.0,
                "base_date": "20260911",
                "base_time": "1200",
            },
            "warnings": {"storm": True},
        },
    }
    original = with_services(kma=_Stub(scenario=live))
    try:
        body = run(main.weather_scenario("제주"))
    finally:
        restore_services(original)
    check("실데이터면 source=live", body["source"] == "live", body["source"])
    check("추천 시나리오를 그대로 전달한다", body["scenario"] == "태풍", body["scenario"])
    check("근거(raw)를 함께 내려보낸다", "observation" in body["raw"])
    check("관측 기준시각을 함께 내려보낸다", body["meta"]["observed_at"].endswith("+09:00"), str(body["meta"]))
    check("기상 프로필 버전을 공개한다", body["meta"]["profile_version"] == main.WEATHER_PROFILE_VERSION)

    for label, stub in (("None 반환", _Stub(scenario=None)), ("모듈 자체가 없음", None)):
        original = with_services(kma=stub)
        try:
            body = run(main.weather_scenario("서울"))
        finally:
            restore_services(original)
        check(f"폴백({label}): source=fallback", body["source"] == "fallback", body["source"])
        # 필드가 사라지거나 비지 않는다. 화면은 배지를 접기만 하면 된다.
        check(f"폴백({label}): scenario 는 유효한 키다", body["scenario"] in main.WEATHER_PROFILES)
        check(f"폴백({label}): 500 을 던지지 않는다", isinstance(body, dict))


def test_operational_contracts():
    health = main.health()
    check("health 는 프로세스 상태를 반환한다", health["status"] == "ok", str(health))
    check("health 는 API 버전을 반환한다", health["version"] == main.API_VERSION, str(health))

    metadata = main.response_metadata()
    check("계산 메타데이터에 모델 버전이 있다", metadata["model_version"] == main.SIMULATION_MODEL_VERSION)
    check("계산 메타데이터에 생성시각이 있다", metadata["generated_at"].endswith("+00:00"), str(metadata))


def test_compare_and_climate_contracts():
    db = SessionLocal()
    try:
        comparison = run(main.compare_regions(
            main.CompareQuery(
                renewable=33.3,
                nuclear=33.3,
                fossil=33.4,
                region_a="서울",
                region_b="부산",
                weather_scenario="맑음",
            ),
            db,
        ))
        check("비교 API가 두 지역을 반환한다", len(comparison["regions"]) == 2)
        check("비교 API가 재현 메타데이터를 반환한다", "model_version" in comparison["meta"])
        climate = main.climate_normals("서울", db)
        check("기후 API는 데이터 유무를 명시한다", isinstance(climate.get("available"), bool))
        if climate["available"]:
            check("기후 API가 적재된 표본 수를 반환한다", climate["period"]["samples"] > 0)
        else:
            check("기후 API가 미적재 사유를 반환한다", bool(climate.get("reason")))
    finally:
        db.close()

    try:
        main.EnergyMix(renewable=101, nuclear=0, fossil=0)
        valid_range = False
    except Exception:
        valid_range = True
    check("에너지 믹스 범위를 검증한다", valid_range)


# ---------------------------------------------------------------------------
# 6. 면책 규칙 — 이번 작업이 건드리면 안 되는 것
# ---------------------------------------------------------------------------

def test_emission_factors_untouched():
    check(
        "배출계수는 그대로다 (재생12·원자력12·화력650)",
        main.EMISSION_FACTORS == {"renewable": 12.0, "nuclear": 12.0, "fossil": 650.0},
        str(main.EMISSION_FACTORS),
    )
    check("배출계수 면책 문구가 남아 있다", "공식 통계 수치가 아닙니다" in main.EMISSION_FACTOR_NOTE)


def test_live_note_still_discloses_what_is_estimated():
    """실데이터 각주도 "무엇이 여전히 추정값인지"를 말해야 한다.

    실데이터가 붙었다고 "전부 실측"이라고 적으면 그게 새로운 과장이 된다
    (README 9.3 면책 원칙).
    """
    note = main.GENERATION_NOTE_LIVE
    check("KPX 를 출처로 밝힌다", "한국전력거래소(KPX)" in note)
    check("지역별 배분이 추정임을 밝힌다", "추정" in note and "지역별 배분" in note)
    check("GW→MWh 환산 한계를 밝힌다", "GW" in note)


def test_scale_total_matches_kpx_module():
    """두 값이 어긋나면 실데이터 적용 순간 지도 마커 크기가 통째로 달라진다."""
    from services import kpx_api as real_kpx
    check(
        "GENERATION_SCALE 합계 == kpx_api.SCALE_TOTAL",
        abs(sum(main.GENERATION_SCALE.values()) - real_kpx.SCALE_TOTAL) < 0.5,
        f"{sum(main.GENERATION_SCALE.values())} vs {real_kpx.SCALE_TOTAL}",
    )


# ---------------------------------------------------------------------------
# 7. 캐시
# ---------------------------------------------------------------------------

def test_cache_reuses_success_and_retries_failure_sooner():
    public_api.cache_clear()
    calls = {"n": 0}

    async def producer():
        calls["n"] += 1
        return {"v": calls["n"]}

    async def scenario():
        first = await public_api.cached("t:ok", producer)
        second = await public_api.cached("t:ok", producer)
        return first, second

    first, second = run(scenario())
    check("성공 응답은 캐시에서 재사용된다 (상류 1회)", calls["n"] == 1, f"호출 {calls['n']}회")
    check("같은 값이 돌아온다", first == second, f"{first} vs {second}")

    # 실패도 캐싱하지만 수명이 짧다 — 상류가 죽었을 때 매 요청이 타임아웃을
    # 기다리지 않게 하는 것이 목적이다.
    fails = {"n": 0}

    async def failing():
        fails["n"] += 1
        return None

    async def fail_twice():
        await public_api.cached("t:fail", failing)
        await public_api.cached("t:fail", failing)

    run(fail_twice())
    check("실패도 잠깐 캐싱된다 (상류 1회)", fails["n"] == 1, f"호출 {fails['n']}회")
    check("실패 캐시가 성공 캐시보다 짧다",
          public_api.FAILURE_TTL_SECONDS < public_api.CACHE_TTL_SECONDS,
          f"{public_api.FAILURE_TTL_SECONDS} < {public_api.CACHE_TTL_SECONDS}")
    check("캐시 수명이 요구 범위(5~10분) 안이다",
          300 <= public_api.CACHE_TTL_SECONDS <= 600,
          f"{public_api.CACHE_TTL_SECONDS}s")

    # producer 가 예외를 던져도 밖으로 새지 않는다 (폴백으로 떨어진다).
    async def boom():
        raise RuntimeError("상류 폭발")

    result = run(public_api.cached("t:boom", boom))
    check("producer 예외는 None 으로 흡수된다", result is None, str(result))
    public_api.cache_clear()


def test_extract_items_absorbs_shape_differences():
    ex = public_api.extract_items
    single = {"response": {"header": {"resultCode": "00"}, "body": {"items": {"item": {"a": 1}}}}}
    listed = {"response": {"header": {"resultCode": "00"}, "body": {"items": {"item": [{"a": 1}, {"a": 2}]}}}}
    empty = {"response": {"header": {"resultCode": "00"}, "body": {"items": ""}}}
    failed = {"response": {"header": {"resultCode": "30", "resultMsg": "SERVICE KEY IS NOT REGISTERED"}, "body": {}}}

    check("item 이 단일 객체여도 리스트로 받는다", ex(single, label="t") == [{"a": 1}])
    check("item 이 리스트면 그대로", len(ex(listed, label="t")) == 2)
    check("items 가 빈 문자열이면 빈 리스트", ex(empty, label="t") == [])
    check("200 + 실패코드는 빈 리스트 (키 미등록 등)", ex(failed, label="t") == [])
    check("None 이 와도 터지지 않는다", ex(None, label="t") == [])
    check("XML 등 예상 밖 형식도 빈 리스트", ex({"weird": 1}, label="t") == [])


def test_placeholder_key_counts_as_missing():
    """`.env.example` 의 자리표시자를 그대로 복사해 둔 경우도 미설정으로 본다.

    그러지 않으면 "your_kma_service_key_here" 를 키로 보내 매번 401 을 받는다.
    """
    os.environ["TEST_KEY_PLACEHOLDER"] = "your_kma_service_key_here"
    os.environ["TEST_KEY_REAL"] = "abcdef123456"
    check("자리표시자는 미설정 취급",
          public_api.service_key("TEST_KEY_PLACEHOLDER", label="t") is None)
    check("실제 키는 그대로 읽힌다",
          public_api.service_key("TEST_KEY_REAL", label="t") == "abcdef123456")
    check("없는 변수는 None", public_api.service_key("TEST_KEY_ABSENT", label="t") is None)


def main_():
    for fn in [
        test_scenario_rules,
        test_base_time_rolls_back_before_publication,
        test_fuel_mapping_folds_thermal,
        test_row_parsing_ignores_year_and_code_fields,
        test_aggregate_sums_thermal_across_fuels,
        test_regions_uses_live_scale_when_available,
        test_regions_falls_back_silently,
        test_live_scale_keeps_the_sliders_alive,
        test_weather_endpoint_live_and_fallback,
        test_operational_contracts,
        test_compare_and_climate_contracts,
        test_emission_factors_untouched,
        test_live_note_still_discloses_what_is_estimated,
        test_scale_total_matches_kpx_module,
        test_cache_reuses_success_and_retries_failure_sooner,
        test_extract_items_absorbs_shape_differences,
        test_placeholder_key_counts_as_missing,
    ]:
        fn()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    for name, ok, detail in RESULTS:
        if not ok:
            print(f"  FAIL  {name}  {detail}")
    for name, ok, _ in RESULTS:
        if ok:
            print(f"  PASS  {name}")
    print(f"\n{passed}/{len(RESULTS)} passed")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main_())
