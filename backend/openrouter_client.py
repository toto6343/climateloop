"""OpenRouter 호출 한 곳.

AI를 쓰는 경로는 둘이다 — 화면 요약 한 문단(agent.py)과 자유 질의응답(chat.py).
한동안 이 둘은 서로 다른 공급자를 불렀다(요약은 Gemini 직접, 대화는 OpenRouter).
같은 화면에 "AI 생성"이라고 적힌 두 산출물이 다른 모델에서 나오니, 배지가 무엇을
가리키는지 말할 수 없었고 장애 원인도 두 갈래로 갈렸다. 그래서 호출을 이 파일
하나로 모은다 — 모델·타임아웃·키·오류 처리를 여기서만 정한다.

무엇을 물을지(프롬프트)는 각 모듈의 몫이고, 어떻게 부를지는 여기의 몫이다.
두 그래프의 call_llm 노드는 build_chat_model() 로 같은 설정의 클라이언트를 받는다 —
모델·base_url·타임아웃·키를 두 파일에 나눠 적으면 언젠가 한쪽만 바뀐다.

API 키:
    OPENROUTER_API_KEY 는 이 프로세스 안에서만 읽는다. 프론트엔드는 자기 서버의
    엔드포인트만 부르고 키를 알지 못한다 — 브라우저 번들에 들어가는 순간 공개된
    것이나 마찬가지이기 때문이다.

임포트 시점에는 키를 검사하지 않는다. 임포트에서 예외를 던지면 키가 없는 환경에서
서버 기동 자체가 흔들리는데, AI 하나가 없다고 시뮬레이션 전체가 멈출 이유는 없다.
키는 실제 호출 시점에 확인한다.
"""

import os

import httpx
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

# main.py 의 load_dotenv() 는 실행 위치(CWD)의 .env 를 찾는다. uvicorn 을 어디서
# 띄우든 backend/.env 를 읽도록 경로를 못박는다.
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=dotenv_path)

# LangChain(ChatOpenAI)은 base 까지만 받고 경로는 스스로 붙인다. httpx 직접 호출은
# 완성된 URL 이 필요하므로 둘을 한 곳에서 파생시킨다.
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_URL = f"{OPENROUTER_BASE_URL}/chat/completions"

# 모델은 환경변수로 갈아끼울 수 있게 두되 기본값을 못박는다.
# 요약과 대화가 같은 모델을 쓴다 — 한 화면에서 나온 두 문장의 말투가 갈리지 않게.
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-2.5-flash-lite")

# 기본 무제한 대기는 안 된다. 데모 중 상류가 늦어지면 화면의 "설명 작성 중" 배지나
# "생각 중..." 점 세 개가 영원히 돈다.
REQUEST_TIMEOUT_SECONDS = 20.0

# 답변 길이 상한. 말풍선 하나나 해설 한 문단이면 충분한 분량.
DEFAULT_MAX_TOKENS = 700


class OpenRouterError(RuntimeError):
    """답을 받아오지 못했다.

    호출부는 이 예외 하나만 잡으면 된다. 상류의 상태코드나 예외 종류를 그대로
    흘려보내지 않는 이유는, 호출부가 할 수 있는 일이 어느 경우든 둘 중 하나
    (폴백 문장으로 대체하거나, 사용자에게 재시도를 안내하거나)뿐이기 때문이다.
    """


def _require_api_key() -> str:
    """키는 호출 시점에만 확인한다.

    임포트에서 예외를 던지면 키가 없는 환경에서 서버 기동 자체가 흔들린다.
    AI 하나가 없다고 시뮬레이션 전체가 멈출 이유는 없다.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise OpenRouterError(
            "OPENROUTER_API_KEY 가 설정되지 않았습니다. backend/.env 를 확인해 주세요."
        )
    return api_key


def build_chat_model(
    temperature: float = 0.3,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> ChatOpenAI:
    """LangGraph 의 call_llm 노드가 쓰는 LLM 클라이언트.

    OpenRouter 는 OpenAI 호환 API 라 ChatOpenAI 에 base_url 만 갈아끼우면 그대로
    동작한다. 그래서 "LangGraph 로 흐름을 관리한다"와 "쿼터는 OpenRouter 하나로
    모은다"가 동시에 성립한다.
    (base_url 은 openai_api_base 와 같은 필드다 — 별칭이라 어느 이름으로 넘겨도 된다)

    timeout/max_retries 를 명시하는 이유는 예전 Gemini 직접 호출 때와 같다.
    기본값은 무제한 대기라, 데모 중 상류가 늦어지면 화면의 배지가 영원히 돈다.

    호출할 때마다 새로 만든다. 모듈 로드 시점에 만들어 두면 키 검사가 임포트
    시점으로 끌려 올라가고, .env 를 고쳐도 서버를 재시작할 때까지 반영되지 않는다.
    """
    return ChatOpenAI(
        model=OPENROUTER_MODEL,
        base_url=OPENROUTER_BASE_URL,
        api_key=_require_api_key(),
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=REQUEST_TIMEOUT_SECONDS,
        max_retries=1,
        # OpenRouter 대시보드에서 어느 앱의 호출인지 구분하는 선택 헤더.
        default_headers={"X-Title": "ClimateLoop"},
    )


def _extract_reply(payload: dict) -> str:
    """응답에서 본문만 꺼낸다.

    200으로 돌아오면서 본문 대신 error 를 담는 경우가 있어(모델 라우팅 실패 등)
    상태코드만 믿지 않고 실제 내용이 있는지 확인한다.
    """
    if isinstance(payload.get("error"), dict):
        raise OpenRouterError(payload["error"].get("message", "상류 API 오류"))

    choices = payload.get("choices") or []
    if not choices:
        raise OpenRouterError("상류 API가 빈 응답을 반환했습니다.")

    content = (choices[0].get("message") or {}).get("content") or ""
    content = content.strip()
    if not content:
        raise OpenRouterError("상류 API가 빈 답변을 반환했습니다.")
    return content


async def call_openrouter(
    messages: list,
    *,
    temperature: float = 0.3,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """messages(OpenAI 호환 배열)를 보내고 답변 본문 문자열을 받는다.

    LangChain 을 거치지 않는 직접 호출 경로. 두 그래프는 build_chat_model() 을
    쓰므로 현재 이 함수를 부르는 곳은 없다 — LangGraph 밖에서 한 번만 물어보고
    싶을 때(스크립트·헬스체크)를 위해 남겨 둔다.

    실패는 전부 OpenRouterError 로 모인다. 그 실패를 폴백으로 덮을지 사용자에게
    알릴지는 부르는 쪽이 정한다 — 요약은 조용히 폴백하고, 대화는 알린다.
    """
    api_key = _require_api_key()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        # OpenRouter 대시보드에서 어느 앱의 호출인지 구분하는 선택 헤더.
        "X-Title": "ClimateLoop",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(OPENROUTER_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        # 상류 응답 본문은 서버 로그에만 남긴다. 키가 섞여 들어올 수 있는 자리라
        # 그대로 사용자에게 돌려보내지 않는다.
        print(f"[openrouter] {exc.response.status_code}: {exc.response.text[:300]}")
        raise OpenRouterError("AI 서버가 요청을 처리하지 못했습니다.") from exc
    except httpx.HTTPError as exc:
        print(f"[openrouter] 연결 실패: {exc}")
        raise OpenRouterError("AI 서버에 연결하지 못했습니다.") from exc
    except ValueError as exc:  # JSON 파싱 실패
        print(f"[openrouter] 응답 파싱 실패: {exc}")
        raise OpenRouterError("AI 서버 응답을 해석하지 못했습니다.") from exc

    return _extract_reply(data)
