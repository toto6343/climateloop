"""CSV 관측자료를 weather_data 테이블에 적재한다.

입력 CSV 필수 열:
    region,date,temp,precipitation,wind_speed,solar_radiation

date는 ISO 날짜/시간(예: 2026-01-01 또는 2026-01-01T00:00:00)이다.
실제 API 호출은 이 스크립트의 책임이 아니다. 내려받은 원자료를 검토한 뒤
명시적으로 적재해, 어떤 데이터가 DB에 들어갔는지 재현 가능하게 한다.

사용 예:
    cd backend
    python scripts/import_weather_data.py data/weather_observations.csv --replace
"""

import argparse
import csv
import os
import sys
from datetime import datetime

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from models.database import SessionLocal, WeatherData, init_db  # noqa: E402

REQUIRED_COLUMNS = {
    "region",
    "date",
    "temp",
    "precipitation",
    "wind_speed",
    "solar_radiation",
}


def parse_date(value: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def parse_float(value: str | None) -> float | None:
    if value is None or not value.strip():
        return None
    return float(value.strip().replace(",", ""))


def import_csv(path: str, replace: bool = False) -> int:
    init_db()
    with open(path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(line for line in handle if not line.lstrip().startswith("#"))
        columns = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise ValueError(f"필수 열이 없습니다: {', '.join(sorted(missing))}")

        db = SessionLocal()
        try:
            if replace:
                db.query(WeatherData).delete()

            inserted = 0
            for line_number, row in enumerate(reader, start=2):
                region = (row.get("region") or "").strip()
                if not region:
                    raise ValueError(f"{line_number}행: region이 비어 있습니다.")
                try:
                    item = WeatherData(
                        region=region,
                        date=parse_date(row["date"]),
                        temp=parse_float(row.get("temp")),
                        precipitation=parse_float(row.get("precipitation")),
                        wind_speed=parse_float(row.get("wind_speed")),
                        solar_radiation=parse_float(row.get("solar_radiation")),
                    )
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"{line_number}행을 읽지 못했습니다: {exc}") from exc
                db.add(item)
                inserted += 1

            db.commit()
            return inserted
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="weather_data 관측자료 CSV 적재")
    parser.add_argument("csv_path", help="관측자료 CSV 경로")
    parser.add_argument("--replace", action="store_true", help="기존 weather_data를 지우고 다시 적재")
    args = parser.parse_args()

    try:
        count = import_csv(args.csv_path, replace=args.replace)
    except (OSError, ValueError) as exc:
        print(f"적재 실패: {exc}", file=sys.stderr)
        return 1

    print(f"weather_data에 {count}개 관측 행을 적재했습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
