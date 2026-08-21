"""화면 요약 생성 그래프 (LangGraph).

    build_context  →  call_llm  →  postprocess  →  END

개발계획서(양식2) ②가 적은 흐름 그대로다 —
"계산 엔진 결과 → 컨텍스트 구성 → LLM 호출 → 응답 후처리".
노드를 나눠 두면 각 단계를 따로 들여다볼 수 있고, 발표 때 화면에 흐르는 로그가
그대로 아키텍처 설명이 된다.

LLM 호출은 LangChain 의 ChatOpenAI 를 OpenRouter base_url 로 돌려 쓴다
(openrouter_client.build_chat_model). 그래서 "LangGraph 로 흐름을 관리한다"와
"쿼터는 OpenRouter 하나로 모은다"가 동시에 성립한다.

실패 정책 — 조용히 폴백:
    이 문장은 없어도 화면이 돌아간다. main.py 가 계산 결과로 만든 결정론적 요약을
    fallback_message 로 함께 넣어 주고, postprocess 가 LLM 문장을 받아내지 못하면
    그것을 그대로 내보낸다. 그래서 이 그래프는 예외를 밖으로 던지지 않는다.
    실패를 알려야 하는 chat.py 와 정확히 반대다 — 대화는 대신 답해 줄 것이 없지만
    요약은 있다.

키 검사:
    임포트 시점에 하지 않는다. 예전에는 GEMINI_API_KEY 가 없으면 이 모듈 임포트가
    예외를 던졌고, main.py 는 그 임포트를 try 로 감싸 서버 기동을 지켜야 했다.
    키는 call_llm 노드가 클라이언트를 만들 때 확인하며, 없으면 폴백으로 떨어진다.
"""

import re
from typing import TypedDict

from langgraph.graph import END, StateGraph

from openrouter_client import OpenRouterError, build_chat_model


def _trace(node: str) -> None:
    """노드 진입 로그. 발표 때 흐름을 그대로 읽을 수 있게 남긴다."""
    print(f"[graph:summary] -> {node}")


class SummaryState(TypedDict, total=False):
    """그래프를 흐르는 상태.

    앞쪽은 main.py 가 넣어 주는 입력(계산 엔진 결과), 뒤쪽은 노드가 채우는 값이다.
    여기서 무엇도 다시 계산하지 않는다 — 화면의 숫자와 문장 속 숫자는 같은
    계산에서 나와야 한다.
    """

    # --- 입력: 계산 엔진 결과 ---
    region: str
    weather_scenario: str
    weather_msg: str
    energy_mix: str
    grid_stability: str
    carbon_emissions: float
    best_source: str
    # 계산 결과로 만든 결정론적 요약. LLM 이 실패하면 이 문장이 그대로 나간다.
    fallback_message: str

    # --- build_context 가 채움 ---
    messages: list

    # --- call_llm 이 채움 (둘 중 하나만) ---
    raw_message: str
    error: str

    # --- postprocess 가 채움: main.py 가 읽는 최종 출력 ---
    ai_message: str
    ai_source: str  # "llm" | "fallback"


SYSTEM_PROMPT = """당신은 친절하고 유능한 기상-에너지 전문가 '루피'입니다.
주어진 시뮬레이션 데이터를 일반인이 이해하기 쉽고 흥미를 느낄 수 있게 설명합니다.

출력 형식 규칙 — 반드시 지킬 것:
프론트엔드가 마크다운을 해석하지 않고 글자 그대로 보여주기 때문에, 마크다운
기호를 쓰면 화면에 '###' 이나 '**' 가 그대로 노출됩니다.
- 마크다운을 일절 사용하지 마세요.
- '#', '##', '###' 같은 제목 기호를 쓰지 마세요.
- '**굵게**', '*기울임*' 같은 강조 기호를 쓰지 마세요.
- '---', '===' 같은 구분선을 쓰지 마세요.
- '-', '*', '1.' 로 시작하는 목록 기호를 쓰지 마세요.
- 번호나 소제목을 붙이지 말고, 사람이 말하듯 자연스럽게 이어서 쓰세요.
- 문단 사이는 빈 줄 하나로만 나누세요.
- 이모지는 자연스러운 선에서 사용해도 좋습니다.

내용 규칙:
- 탄소 배출량 수치의 출처나 근거 기관(특정 정부기관, 논문, 보고서)을 언급하지
  마세요. 제공된 값은 시뮬레이션용 예시 계수로 계산된 것이며 공식 통계가
  아닙니다. 주어진 숫자를 그대로 쓰되, 어디서 나온 값인지는 지어내지 마세요."""


def build_user_prompt(state: SummaryState) -> str:
    """계산 결과를 프롬프트 한 덩어리로 편다."""
    return f"""아래 데이터를 바탕으로 현재 상황을 설명해주세요.
다음 내용을 각각 하나의 문단으로 담되, 번호나 소제목은 붙이지 마세요.
1. 현재 기상 상황이 에너지 생산에 미치는 영향 (긍정적/부정적)
2. 가장 효율이 좋은 에너지원을 칭찬하고 그 이유를 간단히 언급
3. 탄소 배출량의 의미를 다른 것과 비교하여 쉽게 설명 (예: 소나무 몇 그루 심는 효과)
4. 전체적인 상황을 요약하며 긍정적인 조언으로 마무리

[분석 데이터]
- 지역: {state.get('region', '')}
- 기상 시나리오: {state.get('weather_scenario', '')} ({state.get('weather_msg', '')})
- 에너지 믹스: {state.get('energy_mix', '')}
- 전력망 안정성: {state.get('grid_stability', '')}
- 탄소 배출량: {state.get('carbon_emissions', 0)} gCO2/kWh
- 이 지역에서 가장 효율이 좋은 에너지원: {state.get('best_source', '')}

친근한 전문가의 말투로 설명해주세요."""


# ---------------------------------------------------------------------------
# 마크다운 제거
#
# 프롬프트가 이미 금지하고 있지만 모델은 종종 어긴다. 프론트엔드는 마크다운을
# 해석하지 않고 글자 그대로 보여주므로, 어긴 결과가 화면에 '###' 로 남는다.
# 그래서 프롬프트를 믿지 않고 한 번 더 훑는다.
#
# 보수적으로만 지운다 — 줄 앞의 기호와 짝지어진 강조 기호까지다. 본문 한가운데의
# 별표나 하이픈(예: "1.2 - 0.3")은 건드리지 않는다.
# ---------------------------------------------------------------------------

# 줄 앞 공백은 수평 공백([ \t])으로만 잡는다. \s 를 쓰면 개행까지 먹어 문단 사이
# 빈 줄이 사라지는데, 프론트가 whitespace-pre-wrap 으로 그리므로 빈 줄이 곧
# 문단 구분이다.
_HEADING = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]*", re.MULTILINE)
_HR = re.compile(r"^[ \t]*(?:-{3,}|={3,}|\*{3,})[ \t]*$", re.MULTILINE)
_BULLET = re.compile(r"^[ \t]{0,3}[-*+][ \t]+", re.MULTILINE)
_NUMBERED = re.compile(r"^[ \t]{0,3}\d+[.)][ \t]+", re.MULTILINE)
_BOLD = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_ITALIC = re.compile(r"(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)")
_BLANK_RUN = re.compile(r"\n{3,}")


def strip_markdown(text: str) -> str:
    """마크다운 기호를 걷어낸다. 글자는 남기고 기호만 뗀다."""
    text = _HR.sub("", text)
    text = _HEADING.sub("", text)
    text = _BOLD.sub(r"\1", text)
    text = _ITALIC.sub(r"\1", text)
    text = _BULLET.sub("", text)
    text = _NUMBERED.sub("", text)
    # 구분선을 지운 자리에 빈 줄이 겹쳐 남는다. 문단 사이는 빈 줄 하나로.
    return _BLANK_RUN.sub("\n\n", text).strip()


# ---------------------------------------------------------------------------
# 노드
# ---------------------------------------------------------------------------


def build_context_node(state: SummaryState) -> dict:
    """계산 엔진 결과 → LLM 이 읽을 messages 배열."""
    _trace("build_context")
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(state)},
        ]
    }


async def call_llm_node(state: SummaryState) -> dict:
    """OpenRouter 경유 LLM 호출.

    예외를 밖으로 내보내지 않고 error 로 적어 둔다. 폴백 여부를 정하는 곳은
    postprocess 하나여야 하기 때문이다 — 여기서 던지면 그래프가 중단되어
    postprocess 가 아예 돌지 않는다.

    temperature 0: 같은 조건이면 같은 문장이 나오는 편이 낫다. 슬라이더를
    되돌렸을 때 문장까지 달라지면 무엇이 바뀌어서 그런지 읽을 수 없다.
    """
    _trace("call_llm")
    try:
        llm = build_chat_model(temperature=0)
        response = await llm.ainvoke(state["messages"])
        # langchain-core 1.x부터 response.content 는 문자열이 아니라 콘텐츠 블록
        # 리스트다. 그대로 두면 ai_message 가 객체 배열로 직렬화되어 화면이 깨진다.
        # .text 는 str 서브클래스라 안전하다(과거 장애 재발 방지).
        return {"raw_message": str(response.text)}
    except OpenRouterError as exc:
        return {"error": str(exc)}
    except Exception as exc:  # 상류 SDK 가 던지는 그 밖의 예외까지 폴백으로
        return {"error": f"{type(exc).__name__}: {exc}"}


def postprocess_node(state: SummaryState) -> dict:
    """마크다운 제거 + 폴백 결정.

    LLM 문장을 받아내지 못했거나 다듬고 나니 빈 문자열이면, main.py 가 넣어 준
    결정론적 요약을 그대로 내보낸다. 그때 ai_source 는 "fallback" 이다 —
    확신이 없으면 항상 폴백 쪽으로 둔다. LLM 이 쓰지 않은 문장을 AI 생성이라고
    표기하는 쪽이 그 반대보다 나쁘기 때문이다.
    """
    _trace("postprocess")
    fallback = state.get("fallback_message", "")

    error = state.get("error")
    if error:
        # 원인은 로그에만 남긴다. 화면에는 결정론적 요약이 대신 뜨므로
        # 사용자가 할 일은 없다.
        print(f"[graph:summary] 요약 생성 실패, 폴백 문장 사용: {error}")
        return {"ai_message": fallback, "ai_source": "fallback"}

    cleaned = strip_markdown(state.get("raw_message", "") or "")
    if not cleaned:
        print("[graph:summary] 빈 응답, 폴백 문장 사용")
        return {"ai_message": fallback, "ai_source": "fallback"}

    return {"ai_message": cleaned, "ai_source": "llm"}


# ---------------------------------------------------------------------------
# 그래프 조립
# ---------------------------------------------------------------------------

workflow = StateGraph(SummaryState)
workflow.add_node("build_context", build_context_node)
workflow.add_node("call_llm", call_llm_node)
workflow.add_node("postprocess", postprocess_node)

workflow.set_entry_point("build_context")
workflow.add_edge("build_context", "call_llm")
workflow.add_edge("call_llm", "postprocess")
workflow.add_edge("postprocess", END)

summary_graph = workflow.compile()
