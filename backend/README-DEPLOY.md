# Railway 배포 메모

이 파일은 배포 설정이 **왜** 이렇게 되어 있는지를 적어 둔 것이다. 실행 절차는
저장소 루트의 `README_SETUP.md` "프로덕션 실행" 절에 있다.

## Root Directory 는 반드시 `backend`

Railway 서비스 설정의 **Root Directory 를 `backend` 로 지정해야 한다.**

저장소 루트에는 `requirements.txt` 도 `package.json` 도 없고, 하위에
`backend/`(Python)와 `frontend/`(Next.js)가 나란히 있다. Root Directory 를
비워 두면 Nixpacks 가 `frontend/package.json` 을 보고 Node 프로젝트로 판단해
`npm ci && npm run build` 를 만들어 낸다. 그때 나오는 로그가

```
/bin/bash: line 1: npm: command not found
```

이다 — 빌더는 Python 이미지를 골라 두고 빌드 명령만 Node 것을 쓰는 상태다.
`backend` 를 지정하면 `backend/requirements.txt` 만 보이므로 이 경로가 생기지
않고, 같은 디렉터리의 `railway.json` 이 그대로 적용된다.

프론트엔드는 Railway 에서 빌드하지 않는다. Vercel 이 맡는다.

## DB 는 두 군데서 보장한다

배포마다 시드가 필요하다. 시드된 `data/climateloop.db` 는 산출물이라 `.gitignore`
에 있고(의도된 설계), SQLite 는 없는 파일을 **조용히 새로 만든다** — 그래서
"기동은 성공하는데 첫 쿼리가 `no such table: energy_efficiency`" 라는, 로그만
봐서는 정상으로 보이는 실패가 난다. `/calculate`·`/regions` 만 500 이고
`/chat`·`/confidence/levels` 는 200 이면 이 경우다.

1. **빌드 단계** — `railway.json` 의 `buildCommand` 가 시드를 돌린다. 첫 요청을
   기다리게 하지 않고, 실패하면 빌드 로그에서 바로 보인다.
2. **기동 시점** — `main.py` 의 `ensure_seeded()` 가 서버가 실제로 열 파일을
   직접 열어 보고, 계수가 비어 있으면 그 자리에서 채운다.

2번이 있어야 하는 이유: 빌더 종류(Nixpacks·Railpack)·레이어 캐시·마운트된 볼륨에
따라 빌드 때 만든 파일이 런타임에 그 자리에 없을 수 있다. 1번만 믿으면 그 경우가
다시 원인 모를 500 이 된다. 2번은 비어 있을 때만 채우므로 볼륨으로 DB 를 보존하는
구성에서는 하는 일이 없다.

양쪽 모두 `[db:seed]` · `[db:boot]` 접두사로 **DB 절대경로 · 파일 존재 여부 ·
테이블 목록 · row 수**를 찍는다. 배포 로그에서 두 줄의 절대경로가 같은지 보면
"시드는 됐는데 서버가 다른 파일을 보는" 상태를 즉시 구분할 수 있다.

```
[db:boot] DB 절대경로            = /app/data/climateloop.db
[db:boot] 파일 존재              = True (28672 bytes)
[db:boot] 테이블 목록            = ['energy_efficiency', 'weather_data']
[db:boot] energy_efficiency rows = 68 (17 개 시·도)
```

`create_all()` 로 빈 테이블만 만들고 끝내지 않는다 — 실제 삽입은 커밋된 CSV
스냅샷 두 개(EPSIS 설비용량, 한국에너지공단 보급현황)에서 17개 시·도 × 4개
발전원 = 68행을 만든다. 외부 네트워크는 쓰지 않는다.

## `railway.json` 의 각 항목

| 항목 | 이유 |
|---|---|
| `buildCommand: python scripts/seed_db.py` | 시드된 SQLite 파일(`data/climateloop.db`)은 산출물이라 `.gitignore` 에 있다. 저장소에서 클론한 이미지에는 파일이 없고, SQLite 는 없는 파일을 조용히 새로 만들기 때문에 **기동은 성공하지만** 첫 쿼리가 `no such table: energy_efficiency` 로 터진다. 실제로 `/calculate`·`/regions` 만 500 이고 `/chat`·`/confidence/levels` 는 200 이었다. 커밋된 CSV 스냅샷에서 빌드 때 다시 만든다 — 외부 네트워크가 필요 없다 |
| `startCommand` 의 `--port $PORT` | Railway 가 주입하는 포트를 그대로 쓴다. 8000·8080 을 적으면 라우터가 보내는 포트와 어긋난다 |
| `--host 0.0.0.0` | 기본값 127.0.0.1 은 컨테이너 밖에서 닿지 않는다 |
| `healthcheckPath: /confidence/levels` | 이 API 에는 `/` 라우트가 없다(루트는 원래 404 다). 상수만 돌려주는 기존 GET 엔드포인트를 쓴다 — DB·외부 API·LLM 을 건드리지 않으므로 상류 장애로 헬스체크가 흔들리지 않는다 |

## 필요한 환경변수

`CLIMATELOOP_ALLOWED_ORIGINS` 만 필수다. 기본값이 localhost 뿐이라, 지정하지
않으면 Vercel 에서 온 요청은 프리플라이트가 400 으로 떨어지고 브라우저 콘솔에는
`TypeError: Failed to fetch` 만 남는다. 나머지는 전부 폴백 경로가 있다.
