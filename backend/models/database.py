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

DATABASE_URL = "sqlite:///./data/climateloop.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    import os
    if not os.path.exists("./data"):
        os.makedirs("./data")
    init_db()
    print("Database initialized.")
