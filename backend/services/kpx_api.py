"""한국전력거래소(KPX) 연동 — 발전원별 발전량 현황 + 전력시장 발전설비 정보.

두 함수 모두 **성공하면 값, 실패하면 None** 이다. 호출부는 None 을 받으면
기존 로컬 추정(estimate_generation / seed_db.py 의 하드코딩 표)으로 떨어진다.

---
## 이 모듈이 바꾸는 것과 바꾸지 않는 것

README 9.3.2 는 `GENERATION_SCALE`(태양광 120 / 풍력 150 / 수력 100 / 화력 500 MWh)에
대해 "출처가 없는 임의 기준값이며, 정식 활용 전 KPX 설비용량으로 교체해야 한다"고
적어 두었다. 이 모듈이 하는 일이 정확히 그 교체다.

**계산식 구조는 건드리지 않는다.**

    발전원별 추정 발전량 = 지역 효율계수 × 기상 배수 × 믹스 비중 × 기준 발전 규모
                                                                  └─ 이 항만 교체

그래서 슬라이더와 기후 탭은 그대로 살아 있다. 여기서 KPX 발전량을 그대로 덮어쓰면
도넛이 "지금 전국이 실제로 이렇게 발전하고 있다"가 되어 버려, 사용자가 믹스를 움직여도
도넛이 안 움직인다 — 시뮬레이터의 핵심 조작이 죽는다. 그건 실데이터 연동이 아니라
기능 제거다.

**절대 크기는 여전히 추정값이다.** 발전원별 발전량 현황 API 의 단위는 GW(순시 출력)이고
화면 표기는 MWh(에너지)다. 둘을 잇는 데는 이용률·시간 적분이 필요한데 그 데이터가 없다.
그래서 KPX 에서 가져오는 것은 **발전원 간 상대 구성비뿐**이고, 총합 크기는 기존
GENERATION_SCALE 의 합(870)에 맞춰 되돌린다. 즉 실데이터가 바꾸는 것은 "네 발전원의
비율"이고, "MWh 숫자의 절대 크기"는 바꾸지 않는다.

이 구분이 화면 각주 문구와 정확히 일치한다 — "구성은 KPX 실시간 데이터를 반영, 지역별
배분은 여전히 추정 시뮬레이션값".
"""

import os
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
# 공공데이터포털의 KPX 서비스는 상세기능 URL 이 신청 페이지마다 다르게 안내된다.
# 코드에 못박으면 경로가 한 번 바뀔 때 배포가 필요하므로, 전체 URL 을 환경변수로
# 받고 기본값만 적어 둔다. **발급 페이지의 "요청주소"를 그대로 .env 에 넣는 것이
# 가장 확실하다.** 경로가 틀리면 404 → None → 기존 추정값으로 폴백한다.
# ---------------------------------------------------------------------------
KPX_GENERATION_URL = os.getenv(
    "KPX_GENERATION_URL",
    "http://apis.data.go.kr/B552115/PwrAmountByGenSrc/getPwrAmountByGenSrc",
)
# 설비 정보 기본값을 GenFacilInfo/getGenFacilInfo 에서 아래로 고쳤다.
#
# 종전 값은 이 게이트웨이에 존재하지 않는 경로였다 — 실측으로 유효한 인증키를
# 넣어도 HTTP 400 NO_OPENAPI_SERVICE_ERROR(code 12)만 돌아왔고, .env 에
# KPX_CAPACITY_URL 오버라이드가 없으면 이 연동은 승인 여부와 무관하게 늘
# 폴백이었다. 아래 경로는 .env.example 주석이 안내하는 주소이며, 실제로
# resultCode=00 / totalCount=15975 를 돌려준다.
KPX_CAPACITY_URL = os.getenv(
    "KPX_CAPACITY_URL",
    "http://apis.data.go.kr/B552115/PowerMarketGenInfo/getPowerMarketGenInfo",
)

# 인증키는 세 연동이 공유하는 공용 이름을 쓴다 (public_api.PUBLIC_DATA_KEY_ENV).
# 종전 KPX_SERVICE_KEY 라는 이름은 KPX 전용 키가 따로 있는 것처럼 읽혔지만,
# 포털 인증키는 계정 단위라 기상청·에너지공단과 같은 값이다.
KPX_KEY_ENV = PUBLIC_DATA_KEY_ENV

# 화면이 다루는 4개 발전원. 원자력은 도넛에 없다(README 9.3.2).
TARGET_SOURCES = ("태양광", "풍력", "수력", "화력")

# ---------------------------------------------------------------------------
# KPX 연료명 → 화면 발전원 4종
#
# 화력은 합산이다: 유류 + 유연탄 + 가스 + 국내탄(무연탄). KPX 표기가 서비스마다
# 조금씩 다르므로(가스/LNG, 국내탄/무연탄) 알려진 표기를 모두 넣어 둔다.
#
# 양수(揚水)는 넣지 않는다. 저장장치라 발전원으로 더하면 이중 계산이 되고, 수력에
# 합치면 자연 유입 수력과 섞여 "수력이 많은 지역" 판단이 흐려진다.
# 원자력·기타·신재생(집계항)도 4종에 대응되지 않아 제외한다 — 합계는 4종만으로 낸다.
# ---------------------------------------------------------------------------
FUEL_TO_SOURCE = {
    "태양광": "태양광",
    "태양열": "태양광",
    "풍력": "풍력",
    "수력": "수력",
    "소수력": "수력",
    "유류": "화력",
    "중유": "화력",
    "경유": "화력",
    "유연탄": "화력",
    "무연탄": "화력",
    "국내탄": "화력",
    "석탄": "화력",
    "가스": "화력",
    "LNG": "화력",
    "복합": "화력",
}

# 기존 임의 기준값의 총합. 실데이터로 비율만 갈아끼우고 크기는 이 값에 맞춘다
# (위 모듈 docstring 의 "절대 크기는 여전히 추정값" 참고).
# main.py 의 GENERATION_SCALE 을 임포트하면 순환 참조가 되므로 총합만 상수로 둔다.
# 두 값이 어긋나면 지도 마커 크기가 통째로 달라지므로 main.py 쪽에서 검증한다.
SCALE_TOTAL = 870.0

# ---------------------------------------------------------------------------
# KPX area 표기 → seed_db.py 의 17개 시·도 이름
#
# 설비 정보의 area 는 "서울특별시"/"경기도"/"충청남도" 처럼 행정 full name 으로
# 오는 경우가 많고, 약칭으로 오는 경우도 있다. 양쪽을 모두 받는다.
# ---------------------------------------------------------------------------
AREA_ALIASES = {
    "서울": "서울", "서울특별시": "서울",
    "부산": "부산", "부산광역시": "부산",
    "대구": "대구", "대구광역시": "대구",
    "인천": "인천", "인천광역시": "인천",
    "광주": "광주", "광주광역시": "광주",
    "대전": "대전", "대전광역시": "대전",
    "울산": "울산", "울산광역시": "울산",
    "세종": "세종", "세종특별자치시": "세종", "세종시": "세종",
    "경기": "경기", "경기도": "경기",
    "강원": "강원", "강원도": "강원", "강원특별자치도": "강원",
    "충북": "충북", "충청북도": "충북",
    "충남": "충남", "충청남도": "충남",
    "전북": "전북", "전라북도": "전북", "전북특별자치도": "전북",
    "전남": "전남", "전라남도": "전남",
    "경북": "경북", "경상북도": "경북",
    "경남": "경남", "경상남도": "경남",
    "제주": "제주", "제주도": "제주", "제주특별자치도": "제주",
}

# 지역 계수의 기준. 1.0 = 전국 평균 (seed_db.py 와 같은 규약)
REGION_FACTOR_BASE = 1.0

# 계수 상·하한. 정규화만 하면 설비가 거의 없는 조합(서울 수력 등)이 0 에 붙어
# 적합도가 통째로 0 이 되고, 반대로 한 지역에 몰린 발전원은 10배가 넘는 계수가
# 나와 다른 지역이 전부 눌린다. 기존 하드코딩 표의 실제 범위(0.10~2.40)를
# 그대로 상·하한으로 삼아 "상대 유불리 지수"라는 성격을 유지한다.
FACTOR_MIN = 0.10
FACTOR_MAX = 2.40


def _match_source(text: str) -> Optional[str]:
    """연료명 문자열에서 4종 발전원 하나를 찾는다.

    정확히 일치하는 경우를 먼저 보고, 없으면 부분 일치로 넘어간다 — KPX 표기가
    "유연탄(발전)" 처럼 꾸밈말을 달고 오는 경우가 있다. 부분 일치는 긴 이름부터
    본다("소수력"이 "수력"보다 먼저 걸려야 한다).
    """
    cleaned = text.strip()
    if cleaned in FUEL_TO_SOURCE:
        return FUEL_TO_SOURCE[cleaned]
    for fuel in sorted(FUEL_TO_SOURCE, key=len, reverse=True):
        if fuel in cleaned:
            return FUEL_TO_SOURCE[fuel]
    return None


def _row_source_and_value(row: dict) -> tuple[Optional[str], Optional[float]]:
    """한 행에서 (발전원, 숫자) 를 뽑는다.

    공공데이터의 필드명을 맞혀서 읽지 않는다. 서비스마다 fuelType / genSrc /
    powerGenSrc / hydroPower 처럼 이름이 갈리는데, 그걸 전부 나열하는 것보다
    **값을 보고 판별하는 편이 견고하다**:
      - 문자열 필드 중 연료명으로 읽히는 것 → 발전원
      - 숫자 필드 중 가장 큰 것 → 발전량/용량

    "가장 큰 숫자"를 고르는 이유: 행에는 발전량 외에 연도·순번·코드 같은 작은
    정수가 섞여 있고, 실제 발전량·설비용량은 거의 항상 그보다 크다. 완벽한 규칙은
    아니지만, 틀리면 비율이 이상해지는 것이 아니라 대체로 항목이 잡히지 않아
    폴백으로 떨어진다.
    """
    source = None
    for value in row.values():
        if isinstance(value, str):
            matched = _match_source(value)
            if matched:
                source = matched
                break

    if source is None:
        return None, None

    best: Optional[float] = None
    for key, value in row.items():
        # 연도·순번·코드로 읽히는 필드는 숫자여도 발전량이 아니다.
        lowered = str(key).lower()
        if any(token in lowered for token in ("year", "yy", "seq", "no", "code", "id")):
            continue
        parsed = to_float(value)
        if parsed is None or parsed <= 0:
            continue
        if best is None or parsed > best:
            best = parsed

    return source, best


def _aggregate_by_source(rows: list[dict]) -> dict:
    """행 목록을 4종 발전원 합계로 접는다."""
    totals = {source: 0.0 for source in TARGET_SOURCES}
    matched = 0
    for row in rows:
        source, value = _row_source_and_value(row)
        if source is None or value is None:
            continue
        totals[source] += value
        matched += 1
    return {"totals": totals, "matched": matched}


async def _fetch_generation_scale() -> Optional[dict]:
    """발전원별 발전량 현황(GW) → 구성비 기반 기준 발전 규모.

    돌려주는 dict 의 키는 GENERATION_SCALE 과 같다(태양광/풍력/수력/화력).
    그래서 호출부는 상수를 이 값으로 바꿔 끼우기만 하면 된다.
    """
    key = service_key(KPX_KEY_ENV, label="kpx")
    if key is None:
        return None

    payload = await get_json(
        KPX_GENERATION_URL,
        {"serviceKey": key, "dataType": "JSON", "numOfRows": 200, "pageNo": 1},
        label="kpx:generation",
    )
    rows = extract_items(payload, label="kpx:generation")
    if not rows:
        return None

    aggregated = _aggregate_by_source(rows)
    totals = aggregated["totals"]
    grand = sum(totals.values())

    # 네 발전원 중 하나도 못 읽었거나 합이 0 이면 비율을 낼 수 없다.
    if grand <= 0:
        print(f"[kpx:generation] 4종 발전원 합계가 0 입니다 (행 {len(rows)}개, 매칭 {aggregated['matched']}개)")
        return None

    # 화력이 안 잡히는 경우를 특히 조심한다. 화력은 합산 항목이라 표기 하나만
    # 어긋나도 0 이 되는데, 그 상태로 구성비를 쓰면 "화력 0%" 라는 사실과 다른
    # 도넛이 나온다. 4종 모두 잡혔을 때만 실데이터로 인정한다.
    missing = [s for s, v in totals.items() if v <= 0]
    if missing:
        print(f"[kpx:generation] 값이 0인 발전원이 있어 폴백합니다: {missing}")
        return None

    ratios = {source: value / grand for source, value in totals.items()}
    # 비율만 가져오고 총합 크기는 기존 기준값에 맞춘다 (모듈 docstring 참고).
    scale = {source: round(ratio * SCALE_TOTAL, 1) for source, ratio in ratios.items()}

    return {
        "scale": scale,
        "ratios": {source: round(ratio * 100, 2) for source, ratio in ratios.items()},
        "raw_totals": {source: round(value, 3) for source, value in totals.items()},
        "rows_matched": aggregated["matched"],
    }


async def generation_scale() -> Optional[dict]:
    """KPX 실시간 발전원 구성비로 만든 기준 발전 규모. 실패하면 None."""
    return await cached("kpx:generation-scale", _fetch_generation_scale)


async def _fetch_region_factors() -> Optional[dict]:
    """전력시장 발전설비 정보 → 지역별·발전원별 정규화 계수.

    산출 방식(seed_db.py 의 규약을 그대로 따른다):
      1. area × 연료 로 설비용량을 합산
      2. 발전원별로 "전국 평균 지역 용량"을 구한다
      3. 계수 = 그 지역 용량 / 전국 평균  → 1.0 이 전국 평균

    계산식 구조를 바꾸지 않는다는 제약을 지킨다. 바뀌는 것은 68개 계수의 **값**
    뿐이고, 그 값이 들어가는 자리(지역 계수 × 기상 배수 × 믹스 비중)는 그대로다.
    """
    key = service_key(KPX_KEY_ENV, label="kpx")
    if key is None:
        return None

    payload = await get_json(
        KPX_CAPACITY_URL,
        {"serviceKey": key, "dataType": "JSON", "numOfRows": 2000, "pageNo": 1},
        label="kpx:capacity",
    )
    rows = extract_items(payload, label="kpx:capacity")
    if not rows:
        return None

    # (지역, 발전원) -> 설비용량 합
    grid: dict[str, dict[str, float]] = {}
    matched = 0
    for row in rows:
        # ── 지역은 area 필드에서만 읽는다 ──
        #
        # 종전에는 행의 모든 문자열 필드를 훑어 시·도 이름과 일치하는 첫 값을
        # 지역으로 삼았다. 응답 형식이 서비스마다 흔들리는 것을 흡수하려는
        # 의도였지만, 실제 데이터에서 그 관용이 오답을 만들었다.
        #
        # 15,975 행 전수를 확인한 결과 시·도 이름이 걸린 필드는 둘이었다:
        #   area    → 1,984 행 (전부 "제주")
        #   company →    22 행 ("부산광역시", "인천광역시" …)
        # 뒤쪽은 지자체가 소유한 소각장 자가발전기다(genNm="청라소각장 발전기",
        # company="인천광역시"). 설비가 **어디 있는지**가 아니라 **누가 갖고
        # 있는지**를 지역으로 읽은 것이고, 그렇게 잡힌 6개 지역이 계수에
        # 들어가면 근거 없는 값이 된다.
        #
        # area 로 한정하면 이 데이터에서 잡히는 지역은 제주 하나뿐이고, 아래
        # 하한(9개)에 걸려 정직하게 폴백한다. 지역을 억지로 채우는 것보다
        # "이 API 로는 시·도 계수를 만들 수 없다"가 사실이다 — 이 서비스의
        # area 필드는 수도권 / 비수도권 / 제주 3분할이다.
        area = row.get("area")
        region = AREA_ALIASES.get(area.strip()) if isinstance(area, str) else None
        if region is None:
            continue

        source, capacity = _row_source_and_value(row)
        if source is None or capacity is None:
            continue

        grid.setdefault(region, {source: 0.0 for source in TARGET_SOURCES})
        grid[region][source] += capacity
        matched += 1

    # 지역이 너무 적게 잡히면 "전국 평균"이 평균이 아니다. 절반(9개) 미만이면
    # 정규화 기준을 신뢰할 수 없으므로 폴백한다.
    if len(grid) < 9:
        print(f"[kpx:capacity] 지역이 {len(grid)}개만 잡혀 폴백합니다 (행 {len(rows)}개)")
        return None

    factors: dict[str, dict[str, float]] = {}
    for source in TARGET_SOURCES:
        values = [grid[region].get(source, 0.0) for region in grid]
        mean = sum(values) / len(values) if values else 0.0
        for region in grid:
            raw = grid[region].get(source, 0.0)
            # 전국 평균이 0 인 발전원은 정규화할 기준이 없다. 그 발전원만
            # 중립값(1.0)으로 두어 지역 간 차이를 주장하지 않는다.
            factor = REGION_FACTOR_BASE if mean <= 0 else raw / mean
            factor = max(FACTOR_MIN, min(FACTOR_MAX, factor))
            factors.setdefault(region, {})[source] = round(factor, 2)

    # DB 컬럼명(solar/wind/hydro/thermal)으로 옮긴다. seed_db.py 가 그대로 넣는다.
    column = {"태양광": "solar", "풍력": "wind", "수력": "hydro", "화력": "thermal"}
    return {
        "factors": {
            region: {column[source]: value for source, value in per_source.items()}
            for region, per_source in factors.items()
        },
        "regions_matched": len(grid),
        "rows_matched": matched,
    }


async def region_factors() -> Optional[dict]:
    """KPX 설비용량으로 만든 지역별 발전원 계수. 실패하면 None."""
    return await cached("kpx:region-factors", _fetch_region_factors)
