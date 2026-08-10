# ClimateLoop Setup Guide

This project consists of a FastAPI backend and a Next.js frontend.

## Prerequisites
- Python 3.10+
- Node.js 18+
- npm or yarn

## Backend Setup
1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Create a virtual environment and activate it:
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   `GEMINI_API_KEY` 없이도 서버는 동작합니다 (AI 해설만 요약 문구로 대체).
5. Initialize the database:
   ```bash
   python -m models.database
   ```
   > 저장소에 시드 데이터가 포함된 `data/climateloop.db`가 함께 들어 있어 보통은 이 단계만으로 충분합니다.
   > DB를 새로 만들었거나 지도에서 **모든 지역의 결과가 똑같이 나온다면** 시드를 적재하세요.
   > 지역별 발전효율 계수가 비어 있어 전 지역이 기본값 1.0으로 계산되는 상태입니다.
   >
   > **`seed_db.py`는 저장소 루트에서 실행해야 합니다.** 스크립트가 DB 경로를
   > `backend/data/climateloop.db`로 고정해 두었기 때문에, `backend` 디렉터리에서 실행하면
   > `sqlite3.OperationalError: unable to open database file`로 실패합니다.
   >
   > ```bash
   > cd ..                              # backend -> 저장소 루트
   > python backend/scripts/seed_db.py
   > cd backend                         # 다음 단계를 위해 backend 로 복귀
   > ```
   >
   > 성공 시 `17개 시·도의 발전효율 계수를 적재했습니다.`가 출력됩니다.
6. Run the server (must be run from the `backend` directory — the SQLite path is relative):
   ```bash
   uvicorn main:app --reload
   ```

## Frontend Setup
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. **Create the env file (required — the app will not load without it):**
   ```bash
   cp .env.example .env.local
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```

> The backend must be running first. Open http://localhost:3000 after both are up.

## Environment Variables

Both `.env.example` files document every variable with defaults. Copy them and edit as needed.

### Backend (`backend/.env`)
```bash
cd backend && cp .env.example .env
```
| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | No | AI 해설용. 없으면 계산 결과 기반 요약 문구로 대체되며 서버는 정상 동작합니다. |
| `CLIMATELOOP_DISABLE_AI` | No | `1`이면 Gemini를 호출하지 않습니다. 오프라인 데모·쿼터 절약용. |
| `CLIMATELOOP_ALLOWED_ORIGINS` | No | CORS 허용 오리진. 미지정 시 localhost/127.0.0.1의 3000·3001 포트를 허용합니다. |

### Frontend (`frontend/.env.local`)
```bash
cd frontend && cp .env.example .env.local
```
| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Yes** | 백엔드 주소. 기본값 `http://localhost:8000`. 없으면 화면에 오류 배너가 표시됩니다. |

> 기상청·공공데이터포털 등 외부 데이터 API 키는 필요하지 않습니다. 현재 연동되어 있지 않습니다. (README 1.4 구현 현황 참고)

## Running the Tests

```bash
cd backend && python tests/test_confidence.py    # pytest 불필요
cd frontend && npx tsc --noEmit && npm run build
```

## Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| 화면에 `--` / `계산 중...`만 표시 | `frontend/.env.local` 없음 | `cp .env.example .env.local` 후 dev 서버 재시작 |
| "백엔드에 연결할 수 없습니다" 배너 | 백엔드 미기동 | `cd backend && uvicorn main:app --reload` |
| 프론트를 3000/3001 외 포트에서 실행해 CORS 차단 | 허용 오리진 불일치 | `backend/.env`에 `CLIMATELOOP_ALLOWED_ORIGINS=http://localhost:<포트>` 추가 |
| AI 해설 대신 요약 문구만 표시 | Gemini 키 없음·쿼터 소진·타임아웃(20초) | 정상 동작입니다. 학습 기능은 영향받지 않습니다. |
| PDF 한글이 깨짐 | `backend/fonts/NanumGothic.ttf` 누락 | 저장소에 포함되어 있습니다. 파일 존재를 확인하세요. (라이선스 고지: `backend/fonts/NOTICE.md`, 전문: `backend/fonts/OFL.txt`) |
| 모든 지역 결과가 동일 | 지역별 효율 계수 미적재 | 저장소 **루트**에서 `python backend/scripts/seed_db.py` (Backend Setup 5단계 참고) |
| `seed_db.py` 실행 시 `unable to open database file` | `backend` 디렉터리에서 실행함 | 저장소 루트로 이동 후 `python backend/scripts/seed_db.py` |
