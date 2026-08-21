# ClimateLoop 설치·실행 가이드

FastAPI 백엔드 + Next.js 프론트엔드, 두 프로세스를 함께 띄웁니다.

> **라이선스 안내**: 소스 코드는 MIT 이지만 기상이 마스코트 이미지는 별도 조건
> (출처표시 · 상업적 이용금지)이 적용됩니다. [LICENSE-ASSETS.md](LICENSE-ASSETS.md) 참고.

---

## 요구 환경

| 항목 | 버전 | 확인 |
|---|---|---|
| Python | **3.14** 에서 동작 확인 (3.12 이상 권장) | `python --version` |
| Node.js | **24.x** 에서 동작 확인 (`engines: >=24`) | `node --version` |
| npm | **11.x** (`package-lock.json` 기준 — pnpm/yarn 락 없음) | `npm --version` |

`requirements.txt` 는 장애를 일으킨 이력이 있는 패키지만 정확히 고정합니다
(langgraph·langchain-openai·langchain-core·fastapi·uvicorn). 나머지는 범위 지정입니다.

---

## 설치와 첫 실행

**순서가 중요합니다.** 2단계를 건너뛰면 3단계가
`sqlite3.OperationalError: no such table: energy_efficiency` 로 실패합니다.
서버를 띄우는 것으로는 테이블이 생기지 않습니다 — `main.py` 는 `init_db()` 를
호출하지 않고, 테이블 생성은 2단계에서만 일어납니다.

### 1. 백엔드 의존성

```bash
cd backend
python -m venv venv
# Windows
.\venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env        # 키 없이도 동작합니다 (아래 환경변수 절 참고)
```

### 2. 데이터베이스 테이블 생성 — `backend/` 에서

```bash
python -m models.database
# → Database initialized.
```

`data/climateloop.db` 가 만들어집니다. SQLite 경로가 상대경로라 **반드시
`backend/` 에서** 실행해야 합니다.

### 3. 지역 계수 적재 (시드) — **저장소 루트에서**

```bash
cd ..                                  # backend -> 저장소 루트
python backend/scripts/seed_db.py
```

성공하면 이렇게 끝납니다:

```
17개 시·도의 발전효율 계수를 적재했습니다. (출처: file · 실측 열 4/4)
```

> **이 단계는 필수입니다.** `.gitignore` 가 `backend/data/*.db` 와
> `coefficient_source.json` 을 제외하므로 새로 clone 한 저장소에는 DB 가 없습니다.
> 건너뛰면 17개 시·도 계수가 전부 기본값 1.0 이 되어 **모든 지역의 결과가 똑같이**
> 나옵니다.
>
> `seed_db.py` 는 DB 경로를 `backend/data/climateloop.db` 로 고정해 두었으므로
> **저장소 루트에서** 실행해야 합니다. `backend/` 에서 실행하면
> `unable to open database file` 로 실패합니다. 2단계와 작업 디렉터리가 다릅니다.
>
> `실측 열 4/4` 가 아니라 `builtin` 이 나오면 `backend/data/` 의 두 CSV 스냅샷이
> 없는 경우입니다(저장소에 커밋되어 있습니다).

### 4. 백엔드 기동 — `backend/` 에서

```bash
cd backend
uvicorn main:app --reload
```

http://localhost:8000/docs 에서 API 문서를 확인할 수 있습니다.

### 5. 프론트엔드 — `frontend/` 에서

```bash
cd frontend
npm ci                      # package-lock.json 기준 재현 설치 (npm install 도 가능)
cp .env.example .env.local  # 필수 — 없으면 화면에 오류 배너가 뜹니다
npm run dev
```

http://localhost:3000 을 엽니다. **백엔드가 먼저 떠 있어야 합니다.**

---

## 환경변수

`.env.example` 두 개에 모든 변수와 기본값이 주석으로 적혀 있습니다.

### 백엔드 (`backend/.env`)

| 변수 | 필수 | 없을 때의 동작 |
|---|---|---|
| `OPENROUTER_API_KEY` | 아니오 | AI 해설이 계산 결과 기반 문구로 대체되고 화면 배지가 "즉시 요약"으로 바뀝니다. 채팅만 재시도를 안내합니다. 서버는 정상 기동합니다 |
| `OPENROUTER_MODEL` | 아니오 | `google/gemini-2.5-flash-lite` |
| `CLIMATELOOP_DISABLE_AI` | 아니오 | `1`이면 OpenRouter 를 아예 호출하지 않습니다. 테스트는 항상 이 모드로 돌립니다 |
| `CLIMATELOOP_ALLOWED_ORIGINS` | 아니오 | localhost·127.0.0.1 의 3000·3001 포트만 허용합니다. **외부 도메인에 배포하면 반드시 지정해야 합니다** |
| `PUBLIC_DATA_API_KEY` | 아니오 | 기상청·KPX 실시간 API 가 폴백합니다. **지역 계수는 영향받지 않습니다** — 계수는 저장소에 커밋된 CSV 스냅샷에서 옵니다 |
| `KMA_NCST_URL` · `KMA_WARNING_URL` · `KPX_GENERATION_URL` · `KPX_CAPACITY_URL` | 아니오 | 코드의 기본 주소를 씁니다. 포털이 안내한 요청주소가 다를 때만 지정합니다 |
| `CLIMATELOOP_EXTERNAL_CACHE_TTL` · `_FAILURE_TTL` · `_TIMEOUT` | 아니오 | 480초 · 60초 · 6초 |

### 프론트엔드 (`frontend/.env.local`)

| 변수 | 필수 | 없을 때의 동작 |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **예** | 요청이 잘못된 경로로 나가 화면에 오류 배너가 뜹니다. 기본값 `http://localhost:8000` |

**필수 변수는 `NEXT_PUBLIC_API_URL` 하나입니다.** 나머지는 전부 폴백 경로가 있고,
무엇이 실측이고 무엇이 추정값인지는 API 응답의 `data_source` 필드와 화면 각주가
구분해 표기합니다.

---

## 프로덕션 실행

`Dockerfile` · `docker-compose.yml` · CI 설정은 **없습니다.** 아래가 최소 실행 경로입니다.

```bash
# 백엔드 — 설치·시드는 위 1~3단계와 같다
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000        # --reload 없이

# 프론트엔드
cd frontend
npm ci
npm run build
npm run start                                       # 기본 3000 포트
```

배포 시 반드시 확인할 두 가지:

1. **`CLIMATELOOP_ALLOWED_ORIGINS`** — 기본값이 localhost 뿐이라 외부 도메인에서는
   프론트가 백엔드를 부르지 못하고 CORS 로 차단됩니다.
   ```bash
   CLIMATELOOP_ALLOWED_ORIGINS=https://example.org
   ```
2. **`NEXT_PUBLIC_API_URL`** — 빌드 시점에 클라이언트 번들로 들어갑니다. 값을 바꾸면
   **다시 빌드**해야 합니다. 비밀 값을 넣지 마십시오(브라우저에 그대로 노출됩니다).

SQLite 파일(`backend/data/climateloop.db`)은 상대경로로 열리므로 백엔드는 항상
`backend/` 를 작업 디렉터리로 두고 실행해야 합니다.

---

## 테스트

```bash
cd backend
python tests/test_confidence.py        # 63개 — pytest 불필요
python tests/test_external_sources.py  # 78개

cd frontend
npx tsc --noEmit && npx eslint src && npm run build
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `sqlite3.OperationalError: no such table: energy_efficiency` | 테이블 생성 전에 시드를 돌렸습니다. 서버 기동으로는 테이블이 생기지 않습니다 | `cd backend && python -m models.database` 후 다시 시드 |
| `seed_db.py` 가 `unable to open database file` | `backend/` 에서 실행했습니다 | 저장소 루트로 이동 후 `python backend/scripts/seed_db.py` |
| **모든 지역 결과가 동일** | 시드 미실행 — 계수가 전부 1.0 | 저장소 루트에서 `python backend/scripts/seed_db.py` |
| 시드가 `실측 열 0/4` · `builtin` 으로 끝남 | `backend/data/` 의 CSV 스냅샷 두 개가 없습니다 | 저장소에 커밋되어 있습니다. `git status` 로 삭제 여부를 확인하세요 |
| 화면에 `--` / `계산 중...` 만 표시 | `frontend/.env.local` 없음 | `cp .env.example .env.local` 후 dev 서버 재시작 |
| "백엔드에 연결할 수 없습니다" 배너 | 백엔드 미기동 | `cd backend && uvicorn main:app --reload` |
| 3000·3001 외 포트에서 CORS 차단 | 허용 오리진 불일치 | `backend/.env` 에 `CLIMATELOOP_ALLOWED_ORIGINS=http://localhost:<포트>` |
| AI 해설 대신 요약 문구, 배지가 "즉시 요약" | 키 없음·쿼터 소진·타임아웃 | **정상 동작입니다.** 계산·학습 기능은 영향받지 않습니다 |
| "기상청 실시간 데이터 기준" 배지가 안 뜸 | 기상특보 서비스 활용신청 미승인 | 실황·특보 **두 호출이 모두** 성공해야 판정합니다. 포털에서 두 서비스를 함께 신청하세요 |
| 발전원 구성 도넛이 계속 추정값 | KPX 발전량 현황 API 활용신청 미승인 | 포털에서 신청하면 자동 반영됩니다. 각주가 출처를 구분해 표기합니다 |
