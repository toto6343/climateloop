"""NASA POWER 일별 기상자료를 내려받아 import_weather_data.py용 CSV로 저장한다.

수집 변수:
    T2M                 평균 2m 기온 (deg C)
    PRECTOTCORR         보정 강수량 (mm/day)
    WS10M               10m 풍속 (m/s)
    ALLSKY_SFC_SW_DWN   전천 일사량 (kWh/m2/day)

NASA POWER는 공개 API라 인증키가 필요 없다. 이 스크립트는 원자료를 DB에
직접 넣지 않고 CSV를 만든다. 생성된 파일을 사람이 검토한 뒤
import_weather_data.py로 적재하는 두 단계가 의도된 동작이다.

사용 예:
    cd backend
    python scripts/fetch_weather_data.py --start 20250101 --end 20251231
    python scripts/import_weather_data.py data/weather_power_2025.csv --replace
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import date, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
OUTPUT_COLUMNS = ["region", "date", "temp", "precipitation", "wind_speed", "solar_radiation"]
PARAMETERS = "T2M,PRECTOTCORR,WS10M,ALLSKY_SFC_SW_DWN"

# 시·도 대표 지점. 지역 전체의 평균이 아니라 대표 지점의 일별 자료다.
REGION_POINTS = {
    "서울": (37.5665, 126.9780),
    "부산": (35.1796, 129.0756),
    "대구": (35.8714, 128.6014),
    "인천": (37.4563, 126.7052),
    "광주": (35.1595, 126.8526),
    "대전": (36.3504, 127.3845),
    "울산": (35.5384, 129.3114),
    "세종": (36.4801, 127.2892),
    "경기": (37.2636, 127.0286),
    "강원": (37.8228, 128.1555),
    "충북": (36.6353, 127.4913),
    "충남": (36.6588, 126.6728),
    "전북": (35.8242, 127.1480),
    "전남": (34.8679, 126.9910),
    "경북": (36.5760, 128.5056),
    "경남": (35.2376, 128.6911),
    "제주": (33.4996, 126.5312),
}


def fetch_point(region: str, latitude: float, longitude: float, start: str, end: str) -> list[dict]:
    query = urlencode({
        "parameters": PARAMETERS,
        "community": "RE",
        "longitude": longitude,
        "latitude": latitude,
        "start": start,
        "end": end,
        "format": "JSON",
    })
    request = Request(f"{POWER_URL}?{query}", headers={"User-Agent": "ClimateLoop/1.0"})
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)

    properties = payload.get("properties", {})
    parameter_data = properties.get("parameter", {})
    dates = sorted(set().union(*(values.keys() for values in parameter_data.values())))
    rows = []
    for day in dates:
        values = {name: parameter_data.get(name, {}).get(day) for name in (
            "T2M", "PRECTOTCORR", "WS10M", "ALLSKY_SFC_SW_DWN"
        )}
        if any(value is None or value == -999 for value in values.values()):
            continue
        rows.append({
            "region": region,
            "date": f"{day[:4]}-{day[4:6]}-{day[6:8]}",
            "temp": values["T2M"],
            "precipitation": values["PRECTOTCORR"],
            "wind_speed": values["WS10M"],
            "solar_radiation": values["ALLSKY_SFC_SW_DWN"],
        })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="NASA POWER 일별 기상자료 CSV 수집")
    default_end = date.today()
    default_start = default_end - timedelta(days=365)
    parser.add_argument("--start", default=default_start.strftime("%Y%m%d"), help="시작일 YYYYMMDD")
    parser.add_argument("--end", default=default_end.strftime("%Y%m%d"), help="종료일 YYYYMMDD")
    parser.add_argument("--output", help="출력 CSV 경로")
    parser.add_argument("--delay", type=float, default=0.2, help="요청 사이 대기 초")
    args = parser.parse_args()

    try:
        start_date = date.fromisoformat(f"{args.start[:4]}-{args.start[4:6]}-{args.start[6:8]}")
        end_date = date.fromisoformat(f"{args.end[:4]}-{args.end[4:6]}-{args.end[6:8]}")
    except ValueError as exc:
        print(f"날짜 형식 오류: YYYYMMDD를 사용하세요 ({exc})", file=sys.stderr)
        return 1
    if start_date > end_date:
        print("시작일이 종료일보다 늦습니다.", file=sys.stderr)
        return 1

    output = args.output or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data",
        f"weather_power_{start_date.year}_{end_date.year}.csv",
    )
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)

    rows: list[dict] = []
    for index, (region, (latitude, longitude)) in enumerate(REGION_POINTS.items()):
        print(f"[{index + 1}/{len(REGION_POINTS)}] {region} 자료 요청 중...")
        try:
            rows.extend(fetch_point(region, latitude, longitude, args.start, args.end))
        except Exception as exc:
            print(f"  {region} 실패: {exc}", file=sys.stderr)
            return 1
        if index < len(REGION_POINTS) - 1:
            time.sleep(max(0, args.delay))

    with open(output, "w", encoding="utf-8", newline="") as handle:
        handle.write("# source: NASA POWER Daily API\n")
        handle.write(f"# parameters: {PARAMETERS}\n")
        handle.write(f"# period: {args.start} - {args.end}\n")
        handle.write("# coordinates: 17개 시·도 대표 지점, 지역 전체 평균 아님\n")
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"{len(rows)}개 행을 {output}에 저장했습니다.")
    print("다음 단계: python scripts/import_weather_data.py " + output + " --replace")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
