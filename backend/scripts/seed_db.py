"""지역별 발전효율 계수 적재.

68개 계수(17개 시·도 × 4개 발전원)를 발전원별로 다른 출처에서 채운다.

  화력            data/kpx_capacity_by_region_2025.csv (EPSIS 지역별 설비용량)
  태양광·풍력·수력  아래 하드코딩 표 (시뮬레이션용 정규화 지수)

**계산식 구조는 바뀌지 않는다.** 이 표가 채우는 자리는 여전히
"지역 계수 × 기상 배수 × 믹스 비중"의 첫 항이고, 1.0 = 전국 평균이라는 규약도
그대로다 (README 9.0). 바뀌는 것은 값의 출처뿐이다.

── 왜 화력만 실측으로 바뀌는가 ──

EPSIS 의 발전형식 구분은 원자력 / 기력 / 복합화력 / 내연력 / 양수 / 신재생 / 기타다.
화력은 기력+복합화력+내연력으로 정확히 재구성되지만, 태양광·풍력·수력은 "신재생"
한 덩어리에 묶여 있어 갈라낼 수 없다(수력은 별도 열조차 없다 — 양수는 양수발전이라
다른 설비다). 그래서 넷 중 하나만 교체하고, 나머지 셋은 내장 표를 유지한다.

정규화는 발전원별로 독립이므로(각 열을 그 열의 기준값으로 나눈다) 화력만 다른
출처를 써도 "1.0 = 전국 평균" 규약은 열 안에서 그대로 성립한다. 다만 열마다 기준이
다른 데이터라는 사실은 기록에 남아야 한다 — origin="mixed" 와 covered_sources 다.

── 화력 계수의 의미가 바뀌었다 ──

내장 표의 화력 값은 "그 지역이 화력에 얼마나 의존하는가"(수요 관점)에 가까웠다.
설비용량으로 바꾸면 "그 지역에 화력 발전설비가 얼마나 모여 있는가"(공급 관점)가
된다. 서울이 1.30 → 0.87 로 뒤집히는 것이 그 차이다 — 서울은 전력을 많이 쓰지만
발전설비는 적다. 화면 각주도 공급 관점으로 다시 적었다.

어느 출처를 썼는지는 data/coefficient_source.json 에 남긴다. 값만 보고는 출처를
알 수 없으므로, 화면이 실측과 추정값을 구분해 표기하려면 이 기록이 필요하다
(main.py 의 read_coefficient_source 참고).
"""

import asyncio
import csv
import json
import math
import os
import sqlite3
import sys
from datetime import datetime

# services/ 는 backend/ 를 기준으로 임포트된다(main.py 와 같은 규약).
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# DB 경로는 이 파일 위치에서 만든다. 예전엔 'backend/data/climateloop.db' 라
# **저장소 루트에서만** 돌았고, backend/ 안에서 실행하면 unable to open database file
# 이었다. Railway 는 서비스 Root Directory 가 backend/ 라 그쪽에서 실행되므로
# 배포 스크립트가 이 경로에 걸렸다. 이제 어느 디렉터리에서 돌려도 같은 파일을 쓴다
# (models/database.py 의 DB_PATH 와 같은 값이어야 한다 — 같은 파일을 가리킨다).
DB_PATH = os.path.join(BACKEND_DIR, 'data', 'climateloop.db')

SOURCE_RECORD_PATH = os.path.join(BACKEND_DIR, 'data', 'coefficient_source.json')

# EPSIS 지역별 발전설비 용량 스냅샷. 화력 계수의 출처다.
# 파일이 없으면 화력도 내장 표로 떨어진다 — 이 스크립트가 파일 없이도 돌아야 한다.
CAPACITY_CSV_PATH = os.path.join(BACKEND_DIR, 'data', 'kpx_capacity_by_region_2025.csv')

# 한국에너지공단 시·도별 신·재생 설비용량 스냅샷. 태양광·풍력·수력 계수의 출처다.
# 파일이 없으면 그 세 발전원은 내장 표로 떨어진다.
RENEWABLE_CSV_PATH = os.path.join(BACKEND_DIR, 'data', 'kea_renewable_by_region_2024.csv')

# CSV 열 이름 → DB 컬럼. 한 파일에서 세 발전원을 함께 읽는다.
RENEWABLE_COLUMNS = {'solar': 'solar_kw', 'wind': 'wind_kw', 'hydro': 'hydro_kw'}

# 계수 상·하한. kpx_api.py 와 같은 값이어야 한다(같은 자리에 들어가는 값이다).
FACTOR_MIN = 0.10
FACTOR_MAX = 2.40

EFF_COLUMNS = ('solar', 'wind', 'hydro', 'thermal')


def fetch_kpx_factors():
    """KPX 설비용량 기반 계수. 실패하면 None (호출부가 하드코딩 표로 떨어진다).

    임포트 자체를 try 로 감싸는 이유는 main.py 와 같다 — 외부 연동 계층이 없어도
    seed 는 지금까지처럼 동작해야 한다.
    """
    try:
        from services import kpx_api
    except Exception as exc:
        print(f"  KPX 연동 모듈을 불러오지 못했습니다: {exc}")
        return None

    try:
        # region_factors() 는 실패를 예외가 아니라 None 으로 돌려준다.
        return asyncio.run(kpx_api.region_factors())
    except Exception as exc:
        print(f"  KPX 호출 중 예상 밖 예외: {exc}")
        return None


def _read_capacity_csv(path: str, columns: dict):
    """설비용량 CSV → {열이름: {지역: 값}}. 실패하면 None.

    두 스냅샷 파일이 같은 모양이다 — 맨 위에 # 주석 블록, 그 다음 헤더 한 줄,
    그 아래 17개 시·도. 읽는 규칙을 한 곳에 둔다.
    """
    if not os.path.exists(path):
        print(f"  설비용량 CSV 가 없습니다({os.path.basename(path)}).")
        return None

    table = {key: {} for key in columns}
    try:
        with open(path, encoding='utf-8') as handle:
            rows = csv.DictReader(line for line in handle if not line.startswith('#'))
            for row in rows:
                region = (row.get('region') or '').strip()
                if not region:
                    continue
                for key, field in columns.items():
                    raw = (row.get(field) or '').strip()
                    if raw:
                        table[key][region] = float(raw)
    except (OSError, ValueError) as exc:
        print(f"  {os.path.basename(path)} 를 읽지 못했습니다: {exc}")
        return None
    return table


def _log_normalize(capacity: dict, label: str):
    """설비용량 → 계수. 중위 지역 = 1.00, 최대 지역 = 2.00.

    ── 왜 log 스케일인가 ──

    설비용량의 지역 편차가 발전원마다 극단적이다. 실측 편차(최대/최소)는
    화력 475배 · 태양광 51배 · 수력 2,279배이고, 풍력은 세종이 0kW 라 배율이
    성립하지 않는다. 평균으로 나누면(전국 평균 = 1.0) 17개 중 4~14개가 상·하한
    (0.10~2.40)에 눌려 붙어 서로 구분되지 않는다.

    log 스케일은 그 분포를 상·하한 안쪽으로 편다:

        factor = 1 + log10(용량 / 중위) / log10(최대 / 중위)

    용량=중위면 1.00, 용량=최대면 2.00 이다. "1.0 = 전국 평균" 규약이 여기서는
    "1.0 = 전국 중위"가 된다 — 편차가 이만큼 큰 분포에서 평균은 대표값이 아니다
    (화력의 평균 5,123MW 는 17개 지역 중 12개보다 크다).

    ── 0kW 지역 ──

    풍력의 세종처럼 설비가 아예 없는 지역이 있다. log10(0) 은 정의되지 않으므로
    1kW 로 바닥을 깔고 계산하면 하한(0.10)에 떨어진다. 이것은 정직한 결과다 —
    설비가 없는 지역의 "설비 집중도"는 최저다. 다만 하한에 여러 지역이 함께
    붙어 서로 구분되지 않으므로, 몇 개가 붙었는지 기록에 남긴다.
    """
    values = sorted(capacity.values())
    if len(values) < 17:
        print(f"  {label}: 지역이 {len(values)}개뿐입니다.")
        return None

    middle = len(values) // 2
    median = values[middle] if len(values) % 2 else (values[middle - 1] + values[middle]) / 2
    largest = values[-1]
    if median <= 0 or largest <= median:
        print(f"  {label}: 분포가 정규화할 수 없는 모양입니다 "
              f"(중위 {median:,.0f} / 최대 {largest:,.0f}).")
        return None

    span = math.log10(largest / median)
    factors, clamped = {}, []
    for region, amount in capacity.items():
        raw = 1.0 + math.log10(max(amount, 1.0)) / span - math.log10(median) / span
        factor = max(FACTOR_MIN, min(FACTOR_MAX, raw))
        # 표시 자리(소수 둘째)에서 값이 실제로 달라졌을 때만 clamp 로 기록한다.
        # 원값이 0.0999 처럼 경계에 걸치면 반올림 후 같은 값이 되는데, 그것을
        # "0.10 → 0.10" 으로 남기면 무엇이 눌렸는지 읽는 사람이 헷갈린다.
        if round(factor, 2) != round(raw, 2):
            clamped.append(f"{region}({raw:.2f}→{factor:.2f})")
        factors[region] = round(factor, 2)

    return {'factors': factors, 'median': median, 'max': largest, 'clamped': clamped}


def load_thermal_factors():
    """EPSIS 설비용량 CSV → 화력 계수 17개. 실패하면 None (내장 표 유지)."""
    table = _read_capacity_csv(CAPACITY_CSV_PATH, {'thermal': 'thermal_mw'})
    if table is None:
        print("  화력은 내장 표를 씁니다.")
        return None
    result = _log_normalize(table['thermal'], 'kpx:thermal')
    if result is None:
        print("  화력은 내장 표를 씁니다.")
        return None
    print(f"  화력 계수를 EPSIS 설비용량에서 유도했습니다 "
          f"(중위 {result['median']:,.0f}MW = 1.00 · 최대 {result['max']:,.0f}MW = 2.00)")
    if result['clamped']:
        print(f"    상·하한에 걸린 지역: {', '.join(result['clamped'])}")
    return result


def load_renewable_factors():
    """KEA 보급현황 CSV → 태양광·풍력·수력 계수. {열: 결과} 또는 None.

    세 발전원을 한 파일에서 함께 읽지만 정규화는 **열마다 독립**이다. 태양광
    32GW / 풍력 2.3GW / 수력 1.8GW 로 규모가 한 자리씩 다르므로, 한 기준으로
    묶으면 풍력·수력이 통째로 바닥에 눌린다. 열 안에서 중위를 1.00 으로 두면
    "이 발전원 기준으로 이 지역이 어디쯤인가"가 되고, 그것이 이 계수가 곱해지는
    자리(적합도)의 의미와 맞는다.

    부분 성공을 받는다 — 세 열 중 하나가 실패해도 나머지는 쓴다. 열마다 기준이
    독립이므로 한 열이 빠져도 다른 열의 규약이 흔들리지 않고, 무엇이 어디서
    왔는지는 covered_sources 에 열 단위로 기록된다.
    """
    table = _read_capacity_csv(RENEWABLE_CSV_PATH, RENEWABLE_COLUMNS)
    if table is None:
        print("  태양광·풍력·수력은 내장 표를 씁니다.")
        return None

    results = {}
    for column in RENEWABLE_COLUMNS:
        outcome = _log_normalize(table[column], f'kea:{column}')
        if outcome is None:
            print(f"  {column} 은 내장 표를 씁니다.")
            continue
        results[column] = outcome
        print(f"  {column} 계수를 KEA 보급용량에서 유도했습니다 "
              f"(중위 {outcome['median']:,.0f}kW = 1.00 · 최대 {outcome['max']:,.0f}kW = 2.00)")
        if outcome['clamped']:
            print(f"    상·하한에 걸린 지역: {', '.join(outcome['clamped'])}")
    return results or None


def write_source_record(origin: str, note: str, detail: dict = None,
                        covered_sources: dict = None):
    """계수의 출처를 DB 옆에 적어 둔다. DB 스키마는 건드리지 않는다.

    covered_sources 를 따로 두는 이유: origin 하나로는 발전원별로 출처가 갈리는
    상태를 말할 수 없다. "mixed" 는 섞였다는 사실만 알려주고, 무엇이 어디서
    왔는지는 이 표가 답한다 — 화면 각주가 발전원별로 다른 문구를 쓰려면 필요하다.
    """
    os.makedirs(os.path.dirname(SOURCE_RECORD_PATH), exist_ok=True)
    record = {
        'origin': origin,                      # "mixed" | "kpx" | "builtin"
        'seeded_at': datetime.now().isoformat(timespec='seconds'),
        'note': note,
    }
    if covered_sources:
        # {"solar": "builtin", "wind": "builtin", "hydro": "builtin", "thermal": "kpx_file"}
        record['covered_sources'] = covered_sources
    if detail:
        record['detail'] = detail
    with open(SOURCE_RECORD_PATH, 'w', encoding='utf-8') as handle:
        json.dump(record, handle, ensure_ascii=False, indent=2)


def seed_data():
    # 테이블이 없으면 DELETE 가 "no such table" 로 터진다. 예전에는 그 전에
    # `python -m models.database` 를 따로 돌려야 했고, 순서를 놓치는 것이 README
    # 문제해결 표의 첫 줄이었다. 스키마 정의는 여기 두지 않고 그 모듈에 맡긴다 —
    # 정의가 두 곳에 갈라지면 언젠가 어긋난다.
    from models.database import init_db
    init_db()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("DELETE FROM energy_efficiency")

    # -----------------------------------------------------------------------
    # 지역별 발전효율 계수 — 시뮬레이션용 정규화 지수
    #
    # [중요] 아래 수치는 특정 기관이 공표한 통계값이 아니다.
    #        1.0을 전국 평균으로 두고 지역 간 상대적 유불리를 표현하기 위해
    #        설정한 배수이며, 개별 값의 출처는 확인되지 않았다.
    #
    # 목적: "제주는 바람이 강해 풍력이 유리하고, 서울은 재생에너지 여건이
    #        불리하다"는 지역 차이를 학습자가 지도에서 체감하게 하는 것.
    #        절대 발전량이나 설비 이용률을 주장하지 않는다.
    #
    # 정식 활용 전 필요 조치:
    #   태양광 — 신재생에너지데이터센터(KIER) 자원지도
    #   풍력   — 기상자료개방포털 풍력기상자원지도
    #   위 자료의 지역별 값으로 교체해야 한다. 교체 시 이 표만 바꾸면
    #   적합도 차트·지역 적합도 점수·다음 행동 제안에 일괄 반영된다.
    #
    # 값의 의미: 1.0 = 전국 평균 수준, >1.0 = 유리, <1.0 = 불리
    # (Region, Source, Multiplier)
    # -----------------------------------------------------------------------
    data = [
        # Seoul
        ("서울", "solar", 0.95), ("서울", "wind", 0.40), ("서울", "hydro", 0.20), ("서울", "thermal", 1.30),
        # Busan
        ("부산", "solar", 1.15), ("부산", "wind", 1.30), ("부산", "hydro", 0.40), ("부산", "thermal", 1.10),
        # Daegu
        ("대구", "solar", 1.25), ("대구", "wind", 0.60), ("대구", "hydro", 0.30), ("대구", "thermal", 0.90),
        # Incheon
        ("인천", "solar", 1.05), ("인천", "wind", 1.10), ("인천", "hydro", 0.20), ("인천", "thermal", 1.40),
        # Gwangju
        ("광주", "solar", 1.20), ("광주", "wind", 0.50), ("광주", "hydro", 0.40), ("광주", "thermal", 0.80),
        # Daejeon
        ("대전", "solar", 1.10), ("대전", "wind", 0.40), ("대전", "hydro", 0.50), ("대전", "thermal", 0.80),
        # Ulsan
        ("울산", "solar", 1.10), ("울산", "wind", 1.20), ("울산", "hydro", 0.30), ("울산", "thermal", 1.20),
        # Sejong
        ("세종", "solar", 1.05), ("세종", "wind", 0.40), ("세종", "hydro", 0.40), ("세종", "thermal", 0.70),
        # Gyeonggi
        ("경기", "solar", 1.00), ("경기", "wind", 0.60), ("경기", "hydro", 0.80), ("경기", "thermal", 1.10),
        # Gangwon
        ("강원", "solar", 0.95), ("강원", "wind", 1.80), ("강원", "hydro", 2.10), ("강원", "thermal", 0.50),
        # Chungbuk
        ("충북", "solar", 1.10), ("충북", "wind", 0.60), ("충북", "hydro", 1.20), ("충북", "thermal", 0.70),
        # Chungnam
        ("충남", "solar", 1.25), ("충남", "wind", 1.10), ("충남", "hydro", 0.50), ("충남", "thermal", 1.20),
        # Jeonbuk
        ("전북", "solar", 1.35), ("전북", "wind", 1.20), ("전북", "hydro", 0.90), ("전북", "thermal", 0.70),
        # Jeonnam
        ("전남", "solar", 1.55), ("전남", "wind", 1.60), ("전남", "hydro", 0.60), ("전남", "thermal", 0.60),
        # Gyeongbuk
        ("경북", "solar", 1.30), ("경북", "wind", 1.70), ("경북", "hydro", 1.10), ("경북", "thermal", 0.80),
        # Gyeongnam
        ("경남", "solar", 1.20), ("경남", "wind", 1.40), ("경남", "hydro", 0.90), ("경남", "thermal", 0.90),
        # Jeju
        ("제주", "solar", 1.45), ("제주", "wind", 2.40), ("제주", "hydro", 0.10), ("제주", "thermal", 0.40),
    ]

    # -----------------------------------------------------------------------
    # 네 발전원 모두 공표 설비용량에서 나온다 — 출처 파일은 둘이다.
    #
    #   화력            kpx_capacity_by_region_2025.csv  (KPX EPSIS, MW, 2025)
    #   태양광·풍력·수력  kea_renewable_by_region_2024.csv (한국에너지공단, kW, 2024)
    #
    # 두 파일로 갈린 이유: EPSIS 의 발전형식 구분은 재생에너지를 "신재생" 한 덩어리로
    # 두어 태양광·풍력·수력을 나눌 수 없고(수력은 별도 열조차 없다), 반대로 KEA
    # 보급통계는 신·재생만 다루어 화력이 없다. 둘을 합쳐야 네 열이 다 찬다.
    #
    # 기준연도가 2025 와 2024 로 다르다. 정규화가 **열마다 독립**이라 이것이 문제가
    # 되지 않는다 — 각 열은 그 열 안의 중위 지역을 1.00 으로 삼으므로, 열 사이의
    # 절대 크기나 연도를 비교하지 않는다. 애초에 화력 MW 와 태양광 kW 를 한 기준으로
    # 묶을 수도 없다.
    #
    # 부분 성공을 열 단위로 받는다. 한 열이 실패하면 그 열만 내장 표로 떨어지고
    # 나머지는 실측을 쓴다 — 열 안에서 기준이 닫혀 있으므로 규약이 흔들리지 않는다.
    # 다만 어느 열이 어디서 왔는지는 covered_sources 에 반드시 남는다.
    #
    # KPX 실시간 API(fetch_kpx_factors) 는 더 부르지 않는다. 그 API 의 area 필드는
    # 수도권/비수도권/제주 3분할이라 시·도 계수를 만들 수 없다는 것이 확인됐다
    # (services/kpx_api.py 의 지역 매칭 주석 참고).
    # -----------------------------------------------------------------------
    builtin_regions = sorted({region for region, _, _ in data})

    print("EPSIS 설비용량 CSV 로 화력 계수를 보강해 봅니다...")
    thermal = load_thermal_factors()
    print("KEA 보급현황 CSV 로 태양광·풍력·수력 계수를 보강해 봅니다...")
    renewable = load_renewable_factors() or {}

    # 열 → (계수표, 출처이름, 상세). 여기까지 오면 열마다 독립적으로 판정된다.
    resolved = {}
    if thermal is not None:
        resolved['thermal'] = (thermal, 'kpx_file', {
            'file': os.path.basename(CAPACITY_CSV_PATH),
            'unit': 'MW', 'base_year': 2025,
            'source': 'KPX 전력통계정보시스템(EPSIS) 지역별 발전설비 현황',
        })
    for column, outcome in renewable.items():
        resolved[column] = (outcome, 'kea_file', {
            'file': os.path.basename(RENEWABLE_CSV_PATH),
            'unit': 'kW', 'base_year': 2024,
            'source': '한국에너지공단 기초지자체별 신재생에너지 보급 현황',
        })

    covered_sources = {column: 'builtin' for column in EFF_COLUMNS}
    detail = {}
    replacement = {}
    for column, (outcome, origin_name, meta) in resolved.items():
        missing = [r for r in builtin_regions if r not in outcome['factors']]
        if missing:
            print(f"  {column}: CSV 에 빠진 지역이 있어 내장 표를 씁니다: {missing}")
            continue
        replacement[column] = outcome['factors']
        covered_sources[column] = origin_name
        detail[column] = {
            **meta,
            'normalization': 'log10, median=1.00, max=2.00',
            'median': round(outcome['median'], 3),
            'max': round(outcome['max'], 3),
            'clamped': outcome['clamped'],
        }

    if replacement:
        data = [
            (region, column,
             replacement[column][region] if column in replacement else value)
            for region, column, value in data
        ]

    measured = [c for c, v in covered_sources.items() if v != 'builtin']
    # 넷 다 실측일 때만 단일 출처를 주장한다. 하나라도 내장 표면 "mixed" 다.
    if len(measured) == len(EFF_COLUMNS):
        origin = 'file'
    elif measured:
        origin = 'mixed'
    else:
        origin = 'builtin'

    cursor.executemany(
        "INSERT INTO energy_efficiency (region, source, efficiency_score) VALUES (?, ?, ?)",
        data
    )

    conn.commit()
    conn.close()

    if origin == 'file':
        note = ("네 발전원의 지역 계수 모두 공표 설비용량에서 유도했습니다 — 화력은 "
                "한국전력거래소 전력통계정보시스템(EPSIS) 지역별 발전설비 설비용량"
                "(2025, MW), 태양광·풍력·수력은 한국에너지공단 기초지자체별 신재생에너지 "
                "보급 현황의 보급용량(2024, kW)입니다. 발전원마다 그 열의 전국 중위 지역을 "
                "1.0 으로 두고 log 정규화했습니다. 이 값은 설비가 어디에 모여 있는지를 "
                "나타내며, 그 지역의 자원 잠재력이나 전력 수요가 아닙니다 — 자원이 좋아도 "
                "아직 설비가 적은 지역은 낮게 나옵니다.")
    elif origin == 'mixed':
        note = (f"지역 계수의 출처가 발전원마다 다릅니다(실측: {', '.join(sorted(measured))}). "
                "나머지 발전원은 시뮬레이션용 내장 추정표를 씁니다. 실측 계수는 공표 "
                "설비용량을 그 발전원의 전국 중위 지역 1.0 기준으로 log 정규화한 값입니다.")
    else:
        note = ("지역 간 상대 비교를 위한 시뮬레이션용 정규화 지수입니다. "
                "공식 통계가 아니며 개별 값의 출처는 확인되지 않았습니다.")

    write_source_record(origin, note, detail or None, covered_sources)
    print(f"17개 시·도의 발전효율 계수를 적재했습니다. (출처: {origin} · 실측 열 {len(measured)}/4)")
    print(f"주의: {note}")

    print(f"출처 기록: {SOURCE_RECORD_PATH}")

    describe_database()


def describe_database(label: str = "seed") -> dict:
    """방금 쓴 DB 가 어디에 있고 무엇이 들어갔는지 그대로 출력한다.

    이 출력이 없으면 Railway 배포 로그에서 확인할 수 있는 것이 "seed 를 실행했다"
    뿐이다. 정작 알아야 하는 것은 **어느 파일에** 썼는지인데, 예전에는 시드와
    서버가 서로 다른 경로를 열고 있었고(시드 CWD 기준 상대경로 vs 서버 CWD 기준
    상대경로) 그래서 시드가 성공해도 서버는 빈 DB 를 보며
    "no such table: energy_efficiency" 로 터졌다. 두 쪽이 같은 절대경로를
    찍는지 로그만 보고 확인할 수 있어야 한다.

    반환값은 main.py 의 기동 점검이 같은 내용을 다시 계산하지 않고 쓰려고 둔 것이다.
    """
    exists = os.path.exists(DB_PATH)
    tables: list = []
    rows = None
    regions = None

    if exists:
        conn = sqlite3.connect(DB_PATH)
        try:
            tables = sorted(
                r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            )
            if 'energy_efficiency' in tables:
                rows = conn.execute("SELECT COUNT(*) FROM energy_efficiency").fetchone()[0]
                regions = conn.execute(
                    "SELECT COUNT(DISTINCT region) FROM energy_efficiency"
                ).fetchone()[0]
        finally:
            conn.close()

    size = os.path.getsize(DB_PATH) if exists else 0
    print(f"[db:{label}] CWD                    = {os.getcwd()}")
    print(f"[db:{label}] DB 절대경로            = {DB_PATH}")
    print(f"[db:{label}] 파일 존재              = {exists} ({size} bytes)")
    print(f"[db:{label}] 테이블 목록            = {tables}")
    print(f"[db:{label}] energy_efficiency rows = {rows} ({regions} 개 시·도)")

    return {
        "db_path": DB_PATH,
        "exists": exists,
        "size": size,
        "tables": tables,
        "rows": rows,
        "regions": regions,
    }


if __name__ == "__main__":
    seed_data()
