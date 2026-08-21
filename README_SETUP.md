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
| `CLIMATELOOP_ALLOWED_ORIGIN_REGEX` | 아니오 | 정규식 통로를 쓰지 않습니다. Vercel 프리뷰처럼 도메인이 커밋마다 바뀌는 경우에만 지정합니다 |
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

SQLite 파일(`backend/data/climateloop.db`)은 `backend/models/database.py` 위치에서
절대경로로 열립니다. 작업 디렉터리는 상관없지만, **시드는 배포마다 다시 돌려야
합니다** — 이 파일은 산출물이라 저장소에 없고, SQLite 는 없는 파일을 조용히 새로
만들기 때문에 서버는 정상 기동한 뒤 첫 쿼리에서 `no such table` 로 터집니다.

### Railway (백엔드) + Vercel (프론트엔드)

`backend/railway.json` 에 빌드·기동 설정이 들어 있고, 그렇게 둔 이유는
`backend/README-DEPLOY.md` 에 적혀 있습니다. 대시보드에서 지정할 것만 정리하면:

**Railway 서비스**

| 설정 | 값 |
|---|---|
| Root Directory | `backend` — **비워 두면 안 됩니다.** Nixpacks 가 `frontend/package.json` 을 보고 Node 프로젝트로 판단해 `npm: command not found` 로 실패합니다 |
| Build Command | `python scripts/seed_db.py` (`railway.json` 이 이미 지정) |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` (`railway.json` 이 이미 지정) |
| Healthcheck Path | `/confidence/levels` — 이 API 에는 `/` 라우트가 없어 루트는 404 가 정상입니다 |

Railway 환경변수:

```bash
CLIMATELOOP_ALLOWED_ORIGINS=https://<프로젝트>.vercel.app     # 필수
CLIMATELOOP_ALLOWED_ORIGIN_REGEX=https://<프로젝트>-[a-z0-9-]+\.vercel\.app   # 프리뷰 배포도 쓸 때만
OPENROUTER_API_KEY=...                                        # 없으면 AI 해설이 폴백 문구
PUBLIC_DATA_API_KEY=...                                       # 없으면 실시간 배지·구성비가 폴백
```

`$PORT` 는 Railway 가 주입합니다. 직접 8000·8080 을 적지 마십시오.

**Vercel 프로젝트**

| 설정 | 값 |
|---|---|
| Root Directory | `frontend` |
| Framework | Next.js (자동 감지) |

Vercel 환경변수 — Production·Preview 양쪽에 넣어야 합니다:

```bash
NEXT_PUBLIC_API_URL=https://<서비스>.up.railway.app
```

경로 없는 오리진만 넣습니다. 끝에 `/api` 를 붙이면 실시간 기상 호출이
`/api/api/weather/scenario` 가 되어 404 입니다. `NEXT_PUBLIC_*` 은 빌드 시점에
번들로 굳으므로, 값을 넣거나 바꾼 뒤에는 **Redeploy 가 필요합니다** — 환경변수만
저장하고 재배포하지 않으면 화면은 그대로 실패합니다.

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
| `sqlite3.OperationalError: no such table: energy_efficiency` | 시드 미실행. 서버 기동으로는 테이블이 생기지 않습니다 | `python backend/scripts/seed_db.py` — 이 스크립트가 테이블 생성까지 합니다 |
| **모든 지역 결과가 동일** | 시드 미실행 — 계수가 전부 1.0 | `python backend/scripts/seed_db.py` |
| 배포한 백엔드에서 `/calculate`·`/regions` 만 500, `/chat`·`/confidence/levels` 는 200 | 서버가 연 DB 에 테이블·계수가 없습니다(시드된 DB 는 산출물이라 저장소에 없음) | 기동 로그의 `[db:boot]` 줄을 보십시오. `rows = 0` 이면 `ensure_seeded()` 가 그 자리에서 채웁니다. 그 줄 자체가 없으면 배포된 커밋이 이 수정을 담고 있지 않습니다 |
| `[db:boot] 경로 불일치!` 로그 | 시드와 서버가 서로 다른 파일을 가리킵니다 | 두 경로 모두 각 모듈의 파일 위치에서 유도되므로 정상적으로는 나오지 않습니다. 나온다면 `models/database.py` 나 `scripts/seed_db.py` 의 `DB_PATH` 가 수정된 것입니다 |
| 배포한 프론트에서 4개 호출 전부 `TypeError: Failed to fetch` | 백엔드의 `CLIMATELOOP_ALLOWED_ORIGINS` 에 배포 도메인이 없습니다. 프리플라이트가 400 이라 응답 자체가 도착하지 않습니다 | Railway 에 `CLIMATELOOP_ALLOWED_ORIGINS=https://<도메인>` 을 넣고 재배포 |
| 배포한 백엔드 루트 URL 이 `{"detail":"Not Found"}` | **정상입니다.** `/` 라우트가 없습니다 | 헬스체크는 `/confidence/levels` 를, API 목록은 `/docs` 를 보십시오 |
| 시드가 `실측 열 0/4` · `builtin` 으로 끝남 | `backend/data/` 의 CSV 스냅샷 두 개가 없습니다 | 저장소에 커밋되어 있습니다. `git status` 로 삭제 여부를 확인하세요 |
| 화면에 `--` / `계산 중...` 만 표시 | `frontend/.env.local` 없음 | `cp .env.example .env.local` 후 dev 서버 재시작 |
| "백엔드에 연결할 수 없습니다" 배너 | 백엔드 미기동 | `cd backend && uvicorn main:app --reload` |
| 3000·3001 외 포트에서 CORS 차단 | 허용 오리진 불일치 | `backend/.env` 에 `CLIMATELOOP_ALLOWED_ORIGINS=http://localhost:<포트>` |
| AI 해설 대신 요약 문구, 배지가 "즉시 요약" | 키 없음·쿼터 소진·타임아웃 | **정상 동작입니다.** 계산·학습 기능은 영향받지 않습니다 |
| "기상청 실시간 데이터 기준" 배지가 안 뜸 | 기상특보 서비스 활용신청 미승인 | 실황·특보 **두 호출이 모두** 성공해야 판정합니다. 포털에서 두 서비스를 함께 신청하세요 |
| 발전원 구성 도넛이 계속 추정값 | KPX 발전량 현황 API 활용신청 미승인 | 포털에서 신청하면 자동 반영됩니다. 각주가 출처를 구분해 표기합니다 |
