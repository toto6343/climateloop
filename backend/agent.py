import os
from typing import TypedDict, Annotated
import operator

from dotenv import load_dotenv

# 현재 파일의 디렉토리(backend)를 기준으로 .env 파일의 경로를 명시적으로 지정
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path)
 
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END

# 1. 상태 정의: 그래프 내에서 노드 간에 전달될 데이터 구조
class AgentState(TypedDict):
    region: str
    weather_scenario: str
    weather_msg: str
    energy_mix: str
    grid_stability: str
    carbon_emissions: float
    best_source: str
    # 최종 생성된 메시지
    ai_message: str

# 2. LLM 모델 초기화
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY 환경 변수가 설정되지 않았습니다. backend/.env 파일을 확인해주세요.")

llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=api_key, temperature=0)

# 3. 노드 함수 정의: 그래프의 각 단계에서 수행할 작업
def generate_explanation_node(state: AgentState):
    """계산된 데이터를 바탕으로 자연어 설명을 생성합니다."""
    prompt = f"""
    당신은 친절하고 유능한 기상-에너지 전문가 '루피'입니다. 아래 데이터를 바탕으로 현재 상황을 일반인이 이해하기 쉽게, 그리고 흥미를 느낄 수 있도록 설명해주세요.
    설명은 다음 내용을 포함해야 합니다:
    1. 현재 기상 상황이 에너지 생산에 미치는 영향 (긍정적/부정적)
    2. 가장 효율이 좋은 에너지원을 칭찬하고 그 이유를 간단히 언급
    3. 탄소 배출량의 의미를 다른 것과 비교하여 쉽게 설명 (예: 소나무 몇 그루 심는 효과)
    4. 전체적인 상황을 요약하며 긍정적인 조언으로 마무리

    [분석 데이터]
    - 지역: {state['region']}
    - 기상 시나리오: {state['weather_scenario']} ({state['weather_msg']})
    - 에너지 믹스: {state['energy_mix']}
    - 전력망 안정성: {state['grid_stability']}
    - 탄소 배출량: {state['carbon_emissions']} gCO2/kWh
    - 이 지역에서 가장 효율이 좋은 에너지원: {state['best_source']}

    위 내용을 바탕으로, 친근한 전문가의 말투로 설명해주세요.
    """
    response = llm.invoke(prompt)
    return {"ai_message": response.content}

# 4. 그래프 생성 및 노드/엣지 연결
workflow = StateGraph(AgentState)

# 노드를 그래프에 추가
workflow.add_node("generate_explanation", generate_explanation_node)

# 엣지(흐름)를 정의
workflow.set_entry_point("generate_explanation") # 시작점 설정
workflow.add_edge("generate_explanation", END) # generate_explanation 노드 실행 후 종료

# 실행 가능한 앱으로 컴파일
app = workflow.compile()