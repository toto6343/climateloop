"""대화 응답 그래프 (LangGraph).

    build_context  →  trim_history  →  call_llm  →  postprocess  →  END

개발계획서(양식2) ②의 흐름을 대화 쪽에도 그대로 적용한 것이다. 요약 그래프
(agent.py)와 다른 점은 가운데 trim_history 한 칸 — 대화는 이전 기록을 함께
보내야 하고, 그 기록이 무한정 자라면 안 되기 때문이다.

LLM 호출은 요약 그래프와 같은 설정을 쓴다(openrouter_client.build_chat_model).
모델·base_url·타임아웃을 두 파일에 나눠 적지 않으므로 한쪽만 바뀌는 일이 없다.

실패 정책 — 그대로 올려보냄:
    요약(agent.py)은 실패해도 결정론적 폴백 문장이 대신 들어가지만, 대화는 대신
    답해 줄 것이 없다. postprocess 가 OpenRouterError 를 다시 던지고 main.py 가
    503 + 재시도 안내로 바꾼다. 여기서 삼키면 "AI가 그렇게 답했다"와 "답을 못
    받았다"를 화면이 구분할 수 없다.
"""

from typing import TypedDict

from langgraph.graph import END, StateGraph

from openrouter_client import OpenRouterError, build_chat_model

# 대화가 길어져도 프롬프트가 무한정 자라지 않게 최근 것만 넘긴다.
# (한 턴 = 사용자 1 + 어시스턴트 1이므로 메시지 수로는 그 두 배)
MAX_HISTORY_MESSAGES = 12


def _trace(node: str) -> None:
    """노드 진입 로그. 발표 때 흐름을 그대로 읽을 수 있게 남긴다."""
    print(f"[graph:chat] -> {node}")


class ChatState(TypedDict, total=False):
    """그래프를 흐르는 상태."""

    # --- 입력 ---
    message: str
    context: dict
    history: list

    # --- build_context 가 채움 ---
    system_prompt: str
    # --- trim_history 가 채움 ---
    messages: list
    # --- call_llm 이 채움 (둘 중 하나만) ---
    raw_reply: str
    error: str
    # --- postprocess 가 채움 ---
    reply: str


def _format_mix(mix: dict) -> str:
    return (
        f"재생에너지 {mix.get('renewable', 0):.0f}%, "
        f"원자력 {mix.get('nuclear', 0):.0f}%, "
        f"화석연료 {mix.get('fossil', 0):.0f}%"
    )


def _format_factors(factors: list) -> str:
    """감점 요인 목록을 프롬프트 한 줄씩으로 편다. 없으면 빈 문자열."""
    if not factors:
        return ""
    lines = []
    for factor in factors:
        label = factor.get("label", "")
        penalty = factor.get("penalty", 0) or 0
        detail = factor.get("detail", "")
        lines.append(f"  - {label}: -{penalty:.1f}점 ({detail})" if detail
                     else f"  - {label}: -{penalty:.1f}점")
    return "\n".join(lines)


def build_system_prompt(context: dict) -> str:
    """지금 화면에 떠 있는 상태를 그대로 시스템 프롬프트에 적는다.

    사용자는 "이거 왜 이래요?" 처럼 화면을 가리키며 묻는다. 무엇이 떠 있는지
    모델이 모르면 일반론밖에 답할 수 없으므로, 지역·기상·믹스·점수·감점 요인을
    통째로 넘긴다. 값은 백엔드가 이미 계산해 둔 것을 그대로 쓰고 여기서 다시
    계산하지 않는다 — 화면의 숫자와 답변의 숫자는 같은 출처여야 한다.
    """
    lines = [
        "당신은 ClimateLoop 이라는 에너지 시뮬레이션 화면 안에 있는 어시스턴트입니다.",
        "사용자가 지금 보고 있는 시뮬레이션 상황은 다음과 같습니다.",
        "",
        f"- 지역: {context.get('region') or '미지정'}",
        f"- 기후 시나리오: {context.get('weather') or '미지정'}",
        f"- 에너지 믹스: {_format_mix(context.get('mix') or {})}",
    ]

    if context.get("score") is not None:
        lines.append(f"- 지속가능성 점수: {context['score']}점 (100점 만점)")
    if context.get("carbon") is not None:
        lines.append(f"- 탄소 배출량: {context['carbon']} gCO2/kWh")
    if context.get("grid_status"):
        lines.append(f"- 전력망 상태: {context['grid_status']}")
    if context.get("best_source"):
        lines.append(f"- 이 지역에 가장 적합한 발전원: {context['best_source']}")

    factor_lines = _format_factors(context.get("factors") or [])
    if factor_lines:
        lines.append("- 점수를 깎고 있는 요인:")
        lines.append(factor_lines)

    if context.get("summary"):
        lines.append(f"- 화면에 표시 중인 요약: {context['summary']}")

    lines += [
        "",
        "답변 규칙:",
        "- 위 수치를 근거로 답하세요. 화면의 숫자와 다른 값을 지어내지 마세요.",
        "- 이 숫자들은 학습용 시뮬레이션 결과이며 실제 관측·통계가 아닙니다."
        " 출처 기관이나 논문을 지어내지 마세요.",
        "- 모르는 것은 모른다고 답하고, 화면 밖의 사실을 추측해 단정하지 마세요.",
        "- 한국어로, 3~5문장 정도로 짧게 답하세요.",
        "- 마크다운 기호(#, **, -, 1.)를 쓰지 마세요. 화면이 마크다운을 해석하지"
        " 않아 기호가 글자 그대로 노출됩니다.",
        "- 시뮬레이션과 무관한 질문에는 이 화면에서 도울 수 있는 범위를 알려주세요.",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 노드
# ---------------------------------------------------------------------------


def build_context_node(state: ChatState) -> dict:
    """현재 시뮬레이션 상태 → 시스템 프롬프트."""
    _trace("build_context")
    return {"system_prompt": build_system_prompt(state.get("context") or {})}


def trim_history_node(state: ChatState) -> dict:
    """이전 대화를 최근 MAX_HISTORY_MESSAGES 개로 잘라 messages 배열을 완성한다.

    노드로 승격한 이유: 프롬프트가 얼마나 길어졌는지가 응답 지연과 비용을 좌우하는데,
    잘라내는 일이 다른 코드에 묻혀 있으면 그 지점을 짚어 보여줄 수 없다.

    역할이 엉뚱한 줄은 통째로 거절하지 말고 그 줄만 버린다 — 프론트가 보낸
    기록 하나가 이상하다고 대화 전체를 실패시킬 이유는 없다.
    """
    _trace("trim_history")
    history = state.get("history") or []
    kept = 0

    messages = [{"role": "system", "content": state["system_prompt"]}]
    for turn in history[-MAX_HISTORY_MESSAGES:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
            kept += 1

    # 방금 들어온 질문은 기록이 아니라 이번 차례의 입력이므로 항상 맨 끝에 붙는다.
    messages.append({"role": "user", "content": state["message"]})

    print(f"[graph:chat]    history {len(history)}개 중 {kept}개 유지")
    return {"messages": messages}


async def call_llm_node(state: ChatState) -> dict:
    """OpenRouter 경유 LLM 호출.

    요약 그래프와 마찬가지로 예외를 밖으로 내보내지 않고 error 로 적어 둔다.
    무엇을 사용자에게 알릴지 정하는 곳은 postprocess 하나여야 한다.
    """
    _trace("call_llm")
    try:
        llm = build_chat_model()
        response = await llm.ainvoke(state["messages"])
        # langchain-core 1.x 의 content 는 블록 리스트다. .text 로 받는다.
        return {"raw_reply": str(response.text)}
    except OpenRouterError as exc:
        return {"error": str(exc)}
    except Exception as exc:  # 상류 SDK 가 던지는 그 밖의 예외까지 한 줄로
        return {"error": f"{type(exc).__name__}: {exc}"}


def postprocess_node(state: ChatState) -> dict:
    """응답 정리. 받아낸 것이 없으면 OpenRouterError 를 다시 던진다.

    요약 그래프의 postprocess 와 정확히 반대다 — 거기서는 폴백 문장으로 덮고,
    여기서는 실패를 그대로 올려보낸다. 대화에는 대신 내놓을 문장이 없다.
    """
    _trace("postprocess")
    error = state.get("error")
    if error:
        print(f"[graph:chat] 응답 실패: {error}")
        raise OpenRouterError(error)

    reply = (state.get("raw_reply") or "").strip()
    # 200 이어도 본문이 비면 빈 말풍선이 생긴다. 그것도 실패로 다룬다.
    if not reply:
        raise OpenRouterError("상류 API가 빈 답변을 반환했습니다.")

    return {"reply": reply}


# ---------------------------------------------------------------------------
# 그래프 조립
# ---------------------------------------------------------------------------

workflow = StateGraph(ChatState)
workflow.add_node("build_context", build_context_node)
workflow.add_node("trim_history", trim_history_node)
workflow.add_node("call_llm", call_llm_node)
workflow.add_node("postprocess", postprocess_node)

workflow.set_entry_point("build_context")
workflow.add_edge("build_context", "trim_history")
workflow.add_edge("trim_history", "call_llm")
workflow.add_edge("call_llm", "postprocess")
workflow.add_edge("postprocess", END)

chat_graph = workflow.compile()


async def ask_assistant(message: str, context: dict, history: list | None = None) -> str:
    """사용자 질문 한 건에 대한 답변 문자열. 실패하면 OpenRouterError.

    main.py 가 그래프의 상태 스키마를 알 필요는 없으므로 얇게 감싼다.
    """
    final_state = await chat_graph.ainvoke({
        "message": message,
        "context": context,
        "history": history or [],
    })
    return final_state["reply"]
