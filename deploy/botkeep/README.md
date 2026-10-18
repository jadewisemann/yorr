# Botkeep 배포

> 결정과 근거: [ADR-0007](../../backend/docs/adr/0007-botkeep-single-process.md).
> OCI 경로(`deploy/compose.yaml` 등)는 그대로 남아 있다. 이 문서는 Botkeep 경로만 다룬다.

Botkeep 무료 플랜(512MB · 0.5 vCore · 1GB · 슬롯 1개)에 **Node 프로세스 하나**로 올린다.
Redis는 프로세스 안의 구현(ioredis-mock), DB는 Node 내장 SQLite 파일이다.
프론트엔드는 지금처럼 Vercel에 있다.

## 배포물

`npm run build:botkeep`(backend/)이 `deploy/botkeep/out/`에 두 파일을 만든다.

| 파일 | 내용 |
|---|---|
| `yorr.mjs` | 서버 전체 + 런타임 의존성 번들(약 1.9MB). `npm install`이 필요 없다 |
| `package.json` | `engines`(Node ≥ 22.13)와 시작 명령뿐이다 |

`main`에 병합되면 `.github/workflows/botkeep.yml`이 번들을 띄워 블랙박스 스위트를 통과시킨 뒤
**`botkeep` 브랜치**에 커밋한다. 소스는 그 브랜치에 들어가지 않는다.

## 처음 한 번 — 패널 설정

1. 서버를 Node.js로 만들고 **Node 22.13 이상**을 고른다(`node:sqlite`가 플래그 없이 도는 최소선).
2. GitHub 탭에서 `jadewisemann/yorr` · 브랜치 `botkeep`을 연결한다.
3. **시작 명령은 npm을 거치지 않게** 아래를 그대로 넣는다. `npm start`로 띄우면 npm 프로세스가
   약 65MB를 따로 차지한다(512MB 중에서).

   ```
   node --max-old-space-size=128 --max-semi-space-size=2 --disable-warning=ExperimentalWarning yorr.mjs
   ```

   패널이 시작 명령을 고정하고 `npm start`만 허용한다면 그대로 써도 동작한다.
4. 환경 변수:

   | 이름 | 값 | 비고 |
   |---|---|---|
   | `CORS_ALLOWED_ORIGINS` | `https://yorr.site,https://www.yorr.site` | 프론트 출처. REST·WS·로그인 복귀가 함께 쓴다 |
   | `KAKAO_CLIENT_ID` 등 | OCI `.env`와 같은 값 | 소셜 로그인. 없으면 로그인만 거절된다 |
   | `KAKAO_REDIRECT_URI` · `GOOGLE_REDIRECT_URI` | 새 API 주소 기준으로 | 제공자 콘솔 등록값도 같이 바꾼다 |
   | `AUTH_FRONTEND_REDIRECT_URI` | `https://yorr.site/auth/callback` | |
   | `SERVER_PORT` | 패널이 할당 | 패널이 주지 않고 `PORT`만 주면 그 값을 쓴다 |

   `REDIS_DRIVER=memory`·`DB_DRIVER=sqlite`는 번들이 기본으로 깐다. 넣지 않아도 된다.
5. 도메인(예: `api.yorr.site`)을 붙이고 HTTPS를 켠다. 프론트의 API·WS 주소를 그쪽으로 바꾼다.
6. 확인: `curl https://<도메인>/actuator/health` → `{"status":"UP"}`.

## 확인이 필요한 것 (공개 문서에 없다)

- **외부 HTTP·WebSocket 유입**: 문서는 "공개 포트를 가정하지 말라"고 하면서 웹사이트용
  도메인·HTTPS는 지원한다. 할당 포트가 무엇으로 들어오는지(`SERVER_PORT`/`PORT`), 도메인
  프록시가 WebSocket 업그레이드를 통과시키는지 패널에서 확인한다. WS가 막히면 게임이 돌지 않는다.
- **CPU 아키텍처**: 번들은 순수 JS라 상관없다.

## 갱신 · 롤백

- 갱신: `main` 병합 → Actions가 `botkeep` 브랜치를 갱신 → 패널 GitHub 탭에서 당기고 재시작.
  패널의 Redeploy만으로는 GitHub 변경을 당기지 않는다.
- 롤백: 패널에서 `botkeep` 브랜치의 이전 커밋을 고른다. 브랜치는 force push하지 않으므로
  이력이 곧 배포 이력이다.
- 재시작하면 **진행 중인 방과 게스트 세션이 사라진다.** 회원·전적·랭킹은 남는다.
  사람이 없는 시간에 재시작한다.

## 데이터 · 백업

- DB는 작업 디렉터리의 `data/yorr.db`(WAL 모드라 `-wal`·`-shm`이 함께 있다)다.
  `SQLITE_PATH`로 위치를 바꿀 수 있다.
- 패널 백업은 **서버를 멈춘 뒤** 뜬다. 돌아가는 중에 뜬 WAL 파일 묶음은 일관성을 장담할 수 없다.
- 1GB 디스크 중 번들은 2MB 남짓이다. DB는 판당 수백 바이트 수준이다.

## 메모리 실측 (2026-10-18, x86 · Node 24)

| 상태 | RSS |
|---|---|
| 기동 직후 | 약 91MB |
| 블랙박스 스위트 6회 뒤 | 약 139MB (힙 상한 96MB 측정) |
| `npm start` 래퍼 | 별도로 약 65MB |

CI(`botkeep.yml`)가 매 실행마다 번들 크기와 RSS를 요약에 남긴다.
