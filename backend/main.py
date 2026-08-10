import os

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from models.database import SessionLocal, EnergyEfficiency
from dotenv import load_dotenv

load_dotenv()

# LangGraph 에이전트는 GEMINI_API_KEY가 없으면 임포트 시점에 예외를 던진다.
# Confidence 피드백은 결정론적으로 계산되므로 AI 없이도 동작해야 한다.
# 따라서 임포트 실패를 서버 기동 실패로 만들지 않는다.
try:
    from agent import app as agent_app  # LangGraph 에이전트 앱 임포트
except Exception as agent_import_error:  # pragma: no cover
    agent_app = None
    print(f"[warn] AI 에이전트 비활성화: {agent_import_error}")

# 환경변수로 AI 호출을 끌 수 있게 한다 (테스트/오프라인 데모용)
AI_DISABLED = os.getenv("CLIMATELOOP_DISABLE_AI", "").lower() in ("1", "true", "yes")

app = FastAPI(title="ClimateLoop API")

# CORS
# 기존 설정은 allow_origins=["*"] + allow_credentials=True 였는데, 이 조합은 CORS 명세상
# 무효라 브라우저가 인증정보 요청을 거부한다. 이 API는 쿠키·인증을 쓰지 않으므로
# credentials 를 끄고, 오리진은 로컬 개발 주소로 좁힌다.
#
# 프론트를 다른 포트·도메인에서 띄우면 CLIMATELOOP_ALLOWED_ORIGINS 로 지정한다.
#   예: CLIMATELOOP_ALLOWED_ORIGINS=http://localhost:3005
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:3001,http://127.0.0.1:3001"
)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CLIMATELOOP_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# DB Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class EnergyMix(BaseModel):
    renewable: float
    nuclear: float
    fossil: float
    region: str = "서울"
    weather_scenario: str = "맑음" # 맑음, 흐림/비, 태풍, 겨울

WEATHER_PROFILES = {
    "맑음": {"solar_mult": 1.2, "wind_mult": 1.0, "demand_mult": 1.0, "msg": "태양광 발전 최적 조건입니다."},
    "흐림/비": {"solar_mult": 0.2, "wind_mult": 0.8, "demand_mult": 1.1, "msg": "비로 인해 태양광 발전량이 급감했습니다."},
    "태풍": {"solar_mult": 0.1, "wind_mult": 0.0, "demand_mult": 1.2, "msg": "강풍으로 인해 안전을 위해 풍력 발전기가 정지되었습니다."},
    "겨울": {"solar_mult": 0.7, "wind_mult": 1.3, "demand_mult": 1.5, "msg": "난방 수요가 급증하고 일조 시간이 짧아졌습니다."}
}

@app.post("/calculate")
async def calculate_impact(mix: EnergyMix, db: Session = Depends(get_db)):
    # Get weather profile
    weather = WEATHER_PROFILES.get(mix.weather_scenario, WEATHER_PROFILES["맑음"])
    
    # Carbon intensity (gCO2/kWh)
    carbon_emissions = (mix.renewable * 12 + mix.nuclear * 12 + mix.fossil * 650) / 100
    sustainability_score = mix.renewable + mix.nuclear

    # Query realistic multipliers from Database
    efficiencies = db.query(EnergyEfficiency).filter(EnergyEfficiency.region == mix.region).all()
    eff_map = {eff.source: eff.efficiency_score for eff in efficiencies}

    # Fallback if region not in DB
    if not eff_map:
        eff_map = {"solar": 1.0, "wind": 1.0, "hydro": 1.0, "thermal": 1.0}

    # Apply Weather Multipliers
    final_solar = mix.renewable * eff_map.get("solar", 1.0) * weather["solar_mult"]
    final_wind = mix.renewable * eff_map.get("wind", 1.0) * weather["wind_mult"]
    
    suitability = {
        "태양광": min(100, final_solar),
        "풍력": min(100, final_wind),
        "수력": min(100, 45 * eff_map.get("hydro", 1.0)),
        "화력": min(100, mix.fossil * eff_map.get("thermal", 1.0))
    }

    # Power Grid Stability Check
    actual_production = (final_solar + final_wind) / 2 + mix.nuclear + mix.fossil
    demand = 100 * weather["demand_mult"]
    grid_stability = "안정"
    if actual_production < demand:
        grid_stability = "불안정 (전력 부족 위험)"
    elif actual_production > demand + 30:
        grid_stability = "안정 (에너지 과잉/출력제한 필요)"

    renewable_round = round(mix.renewable)
    carbon_round = round(carbon_emissions, 2)

    # AI Message Generation with Gemini
    best_source = max(suitability, key=suitability.get)
    try:
        # LangGraph 에이전트 호출
        initial_state = {
            "region": mix.region,
            "weather_scenario": mix.weather_scenario,
            "weather_msg": weather['msg'],
            "energy_mix": f"신재생 {renewable_round}%, 원자력 {mix.nuclear}%, 화력 {mix.fossil}%",
            "grid_stability": grid_stability,
            "carbon_emissions": carbon_round,
            "best_source": best_source,
        }
        # FastAPI의 비동기 이점을 살리기 위해 ainvoke 사용
        final_state = await agent_app.ainvoke(initial_state)
        ai_msg = final_state.get("ai_message", "AI 메시지를 생성하는 데 실패했습니다.")
    except Exception as e:
        print(f"Agent Error: {e}")
        ai_msg = f"AI 어시스턴트 연결에 실패했습니다: [{mix.region}/{mix.weather_scenario}] {weather['msg']} 탄소 배출량은 {carbon_round} gCO2/kWh 입니다."

    return {
        "carbon_emissions": carbon_round,
        "sustainability_score": round(sustainability_score, 1),
        "suitability": suitability,
        "ai_message": ai_msg,
        "current_region": mix.region,
        "grid_stability": grid_stability,
        "weather_info": weather
    }
