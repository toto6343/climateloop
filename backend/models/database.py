import os

from sqlalchemy import Column, Integer, String, Float, DateTime, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

class WeatherData(Base):
    __tablename__ = "weather_data"
    id = Column(Integer, primary_key=True, index=True)
    region = Column(String, index=True)
    date = Column(DateTime)
    temp = Column(Float)
    precipitation = Column(Float)
    wind_speed = Column(Float)
    solar_radiation = Column(Float)

class EnergyEfficiency(Base):
    __tablename__ = "energy_efficiency"
    id = Column(Integer, primary_key=True, index=True)
    region = Column(String, index=True)
    source = Column(String)  # solar, wind, hydro, thermal
    efficiency_score = Column(Float)

# DB 경로는 이 파일의 위치에서 절대경로로 만든다.
#
# 예전 값은 "sqlite:///./data/climateloop.db" 라 **작업 디렉터리에 따라 다른 파일**을
# 가리켰다. backend/ 밖에서 uvicorn 을 띄우면 시드된 DB 를 못 찾고 SQLite 가 빈
# 파일을 새로 만들며, 첫 쿼리가 "no such table: energy_efficiency" 로 터진다.
# Railway 배포에서 /calculate·/regions 가 500 을 내던 원인이 이것이다
# (기동은 성공하므로 로그만 봐서는 정상으로 보인다).
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "climateloop.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    init_db()
    print(f"Database initialized. ({DB_PATH})")
