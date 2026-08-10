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

# 모델 선정 기록 (2026-08-03 실호출 검증)
#   gemini-1.5-flash  : 404 NOT_FOUND (은퇴)
#   gemini-2.5-flash  : 404 "no longer available to new users" (v1/v1beta, REST 직접 호출도 동일)
#   gemini-2.0-flash  : 429 RESOURCE_EXHAUSTED (쿼터 소진)
#   gemini-3.5-flash  : 정상 (약 4.4s)  <- 채택
# 모델을 바꿀 때는 ListModels 목록만 믿지 말고 실제 generateContent 호출로 확인할 것.
# (2.5-flash는 목록에는 있으나 호출하면 404)
# timeout / max_retries 를 명시한다.
# 기본값은 무제한 대기라, 데모 현장에서 Gemini 응답이 지연되면 요청이 끝나지 않고
# 화면의 "설명 작성 중" 배지가 영원히 돌아간다. 20초를 넘기면 실패로 처리해
# main.py 의 결정론적 폴백 문구로 넘어가게 한다.
# max_retries=1 은 일시적 5xx만 한 번 더 시도하고 끝낸다는 뜻이다.
# (기본 재시도 횟수가 많으면 쿼터 소진 시 20초 × 재시도만큼 지연이 누적된다)
llm = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash",
    google_api_key=api_key,
    temperature=0,
    timeout=20,
    max_retries=1,
)

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

    [출력 형식 규칙 — 반드시 지킬 것]
    프론트엔드가 마크다운을 해석하지 않고 글자 그대로 보여주기 때문에, 마크다운 기호를 쓰면
    화면에 '###' 이나 '**' 가 그대로 노출됩니다. 아래를 반드시 지켜주세요.
    - 마크다운을 일절 사용하지 마세요.
    - 탄소 배출량 수치의 출처나 근거 기관(예: 특정 정부기관, 논문, 보고서)을 언급하지 마세요.
      제공된 값은 시뮬레이션용 예시 계수로 계산된 것이며, 공식 통계가 아닙니다.
      주어진 숫자를 그대로 쓰되, 어디서 나온 값인지는 지어내지 마세요.
    - '#', '##', '###' 같은 제목 기호를 쓰지 마세요.
    - '**굵게**', '*기울임*' 같은 강조 기호를 쓰지 마세요.
    - '---', '===' 같은 구분선을 쓰지 마세요.
    - '-', '*', '1.' 로 시작하는 목록 기호를 쓰지 마세요.
    - 위 1~4번 내용은 각각 하나의 문단으로 쓰고, 문단 사이는 빈 줄 하나로만 나누세요.
      번호나 소제목을 붙이지 말고, 사람이 말하듯 자연스럽게 이어서 쓰세요.
    - 이모지는 자연스러운 선에서 사용해도 좋습니다.

    위 내용을 바탕으로, 친근한 전문가의 말투로 설명해주세요.
    """
    response = llm.invoke(prompt)
    # langchain-core 1.x부터 response.content는 문자열이 아니라 콘텐츠 블록 리스트다.
    # 그대로 반환하면 ai_message가 [{"type":"text",...}] 형태로 직렬화되어
    # 프론트가 객체 배열을 렌더하려다 깨진다. .text는 str 서브클래스라 안전하다.
    # (.text()는 메서드 호출이 deprecated이므로 프로퍼티로 접근한다)
    return {"ai_message": response.text}

# 4. 그래프 생성 및 노드/엣지 연결
workflow = StateGraph(AgentState)

# 노드를 그래프에 추가
workflow.add_node("generate_explanation", generate_explanation_node)

# 엣지(흐름)를 정의
workflow.set_entry_point("generate_explanation") # 시작점 설정
workflow.add_edge("generate_explanation", END) # generate_explanation 노드 실행 후 종료

# 실행 가능한 앱으로 컴파일
app = workflow.compile()