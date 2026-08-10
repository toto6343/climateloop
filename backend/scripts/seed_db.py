import sqlite3
import os

DB_PATH = 'backend/data/climateloop.db'

def seed_data():
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

    cursor.executemany(
        "INSERT INTO energy_efficiency (region, source, efficiency_score) VALUES (?, ?, ?)",
        data
    )

    conn.commit()
    conn.close()
    print("17개 시·도의 발전효율 계수를 적재했습니다.")
    print("주의: 이 값은 지역 간 상대 비교를 위한 시뮬레이션용 정규화 지수이며, 공식 통계가 아닙니다.")

if __name__ == "__main__":
    seed_data()
