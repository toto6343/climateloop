"""공공데이터포털(data.go.kr) 호출 공통부 — TTL 캐시 + 방어적 응답 파싱.

기상청 모듈과 KPX 모듈이 같은 문제를 공유한다.

1. **해커톤 현장 네트워크** (README 13장 리스크). 매 요청마다 상류를 부르면
   슬라이더를 한 번 움직일 때마다 외부 호출이 나간다. /calculate 는 300ms 디바운스로
   초당 몇 번씩 들어올 수 있으므로, 응답을 5~10분 캐싱해 상류 호출을 분리한다.
   화면의 반응 속도가 상류 지연에 묶이지 않는다는 뜻이기도 하다.

2. **data.go.kr 응답 형식이 일정하지 않다.** 같은 포털인데도 서비스마다
   `response.body.items.item` 이 리스트일 때와 단일 객체일 때가 갈리고, 오류를
   200 + `resultCode != "00"` 으로 돌려주는 서비스가 있다. 그래서 상태코드만
   믿지 않고 본문의 결과코드까지 확인한다 (openrouter_client._extract_reply 가
   200 + error 본문을 걸러내는 것과 같은 이유다).

3. **키는 호출 시점에 확인한다.** 임포트에서 예외를 던지면 키가 없는 환경에서
   서버 기동 자체가 흔들린다. 외부 데이터 하나가 없다고 시뮬레이션 전체가 멈출
   이유는 없다 — 키가 없으면 그냥 폴백이다.
"""

import asyncio
import os
import time
import urllib.parse
from typing import Any, Callable, Optional

import httpx
from dotenv import load_dotenv

# main.py 의 load_dotenv() 는 실행 위치(CWD)의 .env 를 찾는다. uvicorn 을 어디서
# 띄우든 backend/.env 를 읽도록 경로를 못박는다 (openrouter_client 와 같은 방식).
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=dotenv_path)


# ---------------------------------------------------------------------------
# 인증키 환경변수 이름 — 세 연동이 공유한다.
#
# 공공데이터포털의 인증키는 **계정 단위**다. 기상청·KPX·에너지공단 서비스에
# 각각 활용신청을 하더라도 발급되는 키 값은 같다. 그런데 종전에는 이름이
# KPX_SERVICE_KEY / KMA_SERVICE_KEY 로 갈라져 있어, 같은 값을 두 번 적어 두거나
# (실제로 그랬다) 한쪽에 엉뚱한 키가 들어가도 드러나지 않았다.
#
# 실제로 KMA_SERVICE_KEY 에는 data.go.kr 키가 아닌 22자짜리 값이 들어 있었고
# (data.go.kr Decoding 키는 88자 base64다) 기상청 호출은 code 30 으로 죽어 있었다.
# 이름을 하나로 모으면 그런 불일치가 생길 자리 자체가 없어진다.
#
# 서비스별로 다른 계정을 쓰고 싶은 경우를 위해 service_key(env_name=...) 로
# 다른 이름을 넘기는 길은 남겨 둔다 — 기본값만 이 공용 이름이다.
# ---------------------------------------------------------------------------
PUBLIC_DATA_KEY_ENV = "PUBLIC_DATA_API_KEY"


def _env_float(name: str, default: float) -> float:
    """숫자 환경변수. 값이 이상하면 기본값으로 되돌린다.

    오타 하나("6O0" 처럼)로 서버가 기동조차 못 하는 것보다, 기본값으로 돌면서
    로그를 남기는 편이 데모 중에 낫다.
    """
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        print(f"[public_api] {name} 값을 숫자로 읽지 못했습니다({raw!r}). 기본값 {default} 을 씁니다.")
        return default


# 캐시 수명. 요구사항이 "5~10분"이므로 그 안쪽인 8분을 기본값으로 둔다.
# 기상 실황은 정시+40분에 한 번 갱신되고 KPX 발전량도 분 단위로는 거의 움직이지
# 않으므로, 이 길이가 화면의 신선도를 해치지 않는다.
CACHE_TTL_SECONDS = _env_float("CLIMATELOOP_EXTERNAL_CACHE_TTL", 480.0)

# 실패도 짧게 캐싱한다.
#
# 상류가 죽어 있을 때 이걸 두지 않으면, 데모 중 슬라이더를 움직이는 동안 매번
# 타임아웃을 기다리며 실패한다 — 폴백은 정상 동작하지만 응답이 매번 타임아웃만큼
# 늦어진다. 한 번 실패했으면 잠깐은 묻지 않고 바로 폴백으로 간다.
FAILURE_TTL_SECONDS = _env_float("CLIMATELOOP_EXTERNAL_FAILURE_TTL", 60.0)

# 상류가 늦어질 때 화면을 붙잡아 두지 않는다. AI 호출(20s)보다 짧게 잡는 이유는
# 이 값이 /calculate 응답 시간에 그대로 실리기 때문이다 — 폴백이 있으니
# 오래 기다릴 이유가 없다.
REQUEST_TIMEOUT_SECONDS = _env_float("CLIMATELOOP_EXTERNAL_TIMEOUT", 6.0)


class _Entry:
    """캐시 한 칸. 성공값과 실패를 함께 담는다.

    실패를 None 값으로만 표현하면 "아직 안 불러봤다"와 "불러봤는데 실패했다"를
    구분할 수 없어서, 실패 캐시가 매번 재시도로 새어 나간다.
    """

    __slots__ = ("value", "expires_at", "ok")

    def __init__(self, value: Any, expires_at: float, ok: bool):
        self.value = value
        self.expires_at = expires_at
        self.ok = ok


_cache: dict[str, _Entry] = {}
# 키별 락. 같은 키에 동시 요청이 몰릴 때 상류를 한 번만 부른다(스탬피드 방지).
# /regions 와 /calculate 가 같은 타이밍에 나가므로 실제로 겹친다.
_locks: dict[str, asyncio.Lock] = {}


def _now() -> float:
    """단조 시계를 쓴다. 시스템 시각이 바뀌어도 캐시 수명이 뒤집히지 않는다."""
    return time.monotonic()


def cache_clear() -> None:
    """테스트·수동 갱신용. 운영 경로에서는 부르지 않는다."""
    _cache.clear()


async def cached(key: str, producer: Callable[[], Any]) -> Any:
    """producer() 결과를 TTL 동안 재사용한다.

    producer 는 성공 시 값, 실패 시 None 을 돌려주는 코루틴이어야 한다.
    None 도 캐싱하지만 수명이 훨씬 짧다(FAILURE_TTL_SECONDS) — 상류가 돌아오면
    1분 안에 다시 시도한다는 뜻이다.
    """
    entry = _cache.get(key)
    if entry is not None and entry.expires_at > _now():
        return entry.value

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        # 락을 기다리는 동안 다른 요청이 채워 놓았을 수 있다. 다시 확인한다.
        entry = _cache.get(key)
        if entry is not None and entry.expires_at > _now():
            return entry.value

        try:
            value = await producer()
        except Exception as exc:
            # producer 는 스스로 None 을 돌려주도록 만들어져 있다. 이 except 는
            # 그럼에도 새어 나온 예외까지 폴백으로 떨어뜨리는 안전망이다.
            print(f"[public_api] {key} 예상 밖 예외: {exc}")
            value = None

        ok = value is not None
        ttl = CACHE_TTL_SECONDS if ok else FAILURE_TTL_SECONDS
        _cache[key] = _Entry(value, _now() + ttl, ok)
        return value


async def get_json(url: str, params: dict, *, label: str) -> Optional[dict]:
    """GET 해서 JSON dict 를 돌려준다. 실패는 전부 None.

    공공데이터포털은 오류를 XML 로 돌려주는 경우가 흔하다(키 미등록, 트래픽 초과).
    그때 response.json() 이 터지므로 파싱 실패도 실패로 접수한다.

    상류 응답 본문은 서버 로그에만 남긴다 — serviceKey 가 에코로 섞여 돌아오는
    자리라 사용자에게 그대로 돌려보내지 않는다 (openrouter_client 와 같은 규칙).
    """
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        print(f"[{label}] HTTP {exc.response.status_code}: {exc.response.text[:200]}")
    except httpx.HTTPError as exc:
        print(f"[{label}] 연결 실패: {exc}")
    except ValueError as exc:
        # JSON 이 아니다 — 거의 항상 포털이 XML 오류를 돌려준 경우다.
        print(f"[{label}] JSON 파싱 실패(포털이 XML 오류를 반환했을 수 있습니다): {exc}")
    return None


def extract_items(payload: Optional[dict], *, label: str) -> list[dict]:
    """data.go.kr 표준 응답에서 item 목록만 꺼낸다.

    형식이 서비스마다 흔들리는 지점을 한 곳에서 흡수한다.
      - items 가 리스트일 때 / 단일 dict 일 때
      - items 자체가 빈 문자열일 때(데이터 없음을 이렇게 표현하는 서비스가 있다)
      - 200 인데 resultCode 가 "00" 이 아닐 때 (키 미승인·파라미터 오류)

    결과가 없으면 빈 리스트다. 호출부는 "비었으면 폴백"으로 처리하면 된다.
    """
    if not isinstance(payload, dict):
        return []

    response = payload.get("response")
    if not isinstance(response, dict):
        return []

    header = response.get("header") or {}
    code = str(header.get("resultCode", "")).strip()
    # "00" / "0" 을 성공으로 본다. 서비스마다 자리수 표기가 다르다.
    if code and code not in ("00", "0"):
        print(f"[{label}] 상류 결과코드 {code}: {header.get('resultMsg')}")
        return []

    body = response.get("body")
    if not isinstance(body, dict):
        return []

    items = body.get("items")
    if isinstance(items, dict):
        items = items.get("item")
    if items in (None, "", []):
        return []
    if isinstance(items, dict):
        return [items]
    if isinstance(items, list):
        return [it for it in items if isinstance(it, dict)]
    return []


def to_float(value: Any) -> Optional[float]:
    """숫자 문자열을 float 로. 실패하면 None.

    공공데이터는 결측을 빈 문자열·"-"·"null" 로 표현하는 일이 잦고, 발전량에는
    천 단위 콤마가 붙어 온다. 여기서 한 번에 걸러 낸다.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if text in ("", "-", "null", "None"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def service_key(env_name: str = PUBLIC_DATA_KEY_ENV, *, label: str) -> Optional[str]:
    """공공데이터포털 인증키. 없으면 None (= 조용히 폴백).

    호출 시점에만 확인한다. 키가 없는 환경에서도 서버는 정상 기동해야 하고,
    그때 화면은 지금까지와 똑같이 로컬 추정값으로 동작한다.

    ── Encoding 키를 반드시 디코딩해서 돌려준다 ──

    포털은 같은 키를 두 형태로 발급한다. Decoding 키는 base64 원문이고
    (A-Za-z0-9+/= 만 쓴다), Encoding 키는 그것을 퍼센트 인코딩한 것이라
    "+" 가 "%2B", "=" 가 "%3D" 로 들어 있다.

    이 값들은 httpx 의 params 로 넘어가면서 한 번 더 인코딩된다 — Encoding 키를
    그대로 넘기면 "%2B" 의 "%" 가 "%25" 로 바뀌어 상류에는 깨진 키가 도착한다.
    실측으로 HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED_ERROR(code 30) 가 났고,
    같은 키에 unquote 만 적용하면 같은 요청이 200 을 받는다. 즉 이것은 키가
    잘못된 것이 아니라 **인코딩을 두 번 한** 문제였다.

    "%" 유무로 두 형태를 가른다. Decoding 키의 문자집합(base64)에 "%" 가
    없으므로 이 판별은 모호하지 않다 — "%" 가 있으면 Encoding 키뿐이다.
    이미 Decoding 형인 키에는 unquote 를 걸지 않으므로, 원문에 우연히 "%XX"
    처럼 보이는 부분이 있어도 훼손되지 않는다.
    """
    key = os.getenv(env_name)
    if not key or key.startswith("your_"):
        # .env.example 의 자리표시자(your_...)를 그대로 복사해 둔 경우도 미설정으로 본다.
        # 그러지 않으면 자리표시자를 키로 보내 매번 401 을 받는다.
        return None
    if "%" in key:
        decoded = urllib.parse.unquote(key)
        print(f"[{label}] Encoding 형 인증키를 감지해 디코딩했습니다 "
              f"({env_name}). params 로 넘길 때 이중 인코딩되지 않게 합니다.")
        return decoded
    return key
