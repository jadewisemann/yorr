# 운영 (환경변수 · 모니터링 · 배포 계약)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). 배포 대상은 [Botkeep](https://botkeep.cloud/)
> 무료 플랜의 Node 프로세스 하나다([ADR-0007](../adr/0007-botkeep-single-process.md)).
> 패널 설정·갱신·롤백 절차는 [`deploy/botkeep/README.md`](../../../deploy/botkeep/README.md)에 있다.
>
> 이 문서는 **지금 동작하는 것**만 기술한다. OCI 단일 호스트(compose·Caddy·GHCR·controller)
> 시절의 내용은 git 이력과 [ADR-0006](../adr/0006-github-actions-ghcr-arm64-single-host.md)에 있다.

## 환경변수

기본값은 `config/env.ts`(zod 스킴)가 정본이다. **필수 변수는 하나도 없다** —
전부 기본값이 있어 빈 환경에서도 부팅된다(운영에서 빠뜨리면 로컬 기본값으로 뜨는
것이 그 대가다). 운영 값은 Botkeep 패널의 환경 변수에 넣는다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `SERVER_PORT` | `8080` | 리슨 포트. 패널이 할당한다. 번들은 `SERVER_PORT`가 없고 `PORT`만 있으면 그 값을 쓴다 |
| `SQLITE_PATH` | `data/yorr.db` | 영속 DB 파일(작업 디렉터리 기준). 첫 질의 때 디렉터리째 만든다 |
| `STORE_SNAPSHOT_PATH` | `data/store.json` | 저장소 스냅샷 파일. 빈 문자열이면 끈다(재시작마다 방·세션이 사라진다) |
| `STORE_SNAPSHOT_INTERVAL_MS` | `60000` | 주기적 스냅샷 간격. 비정상 종료 시 잃는 최대 구간이다 |
| `CORS_ALLOWED_ORIGINS` | `https://yorr.site` | REST·WS 공용 허용 출처(콤마 목록). 기본값이 운영 전용인 것이 fail-safe 설계다. **정확 일치**이며 패턴이 아니다 — `allowedOrigins()`가 공백과 끝의 `/`만 정규화한다(브라우저의 `Origin`에는 경로가 없다). **소셜 로그인의 복귀 출처 목록도 이것이다**([auth.md](auth.md) 「복귀 출처」) — 새 프론트 주소를 열 때 손댈 곳이 여기 하나인 이유다 |
| `AUTH_FRONTEND_REDIRECT_URI` | `http://localhost:5173/auth/callback` | 로그인 콜백 후 프론트 복귀. 운영은 `https://yorr.site/auth/callback` |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET`(선택) / `KAKAO_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 카카오 OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 구글 OAuth |

Redis·MySQL 좌표(`REDIS_*`·`DB_*`·`DB_URL`)는 **더 이상 읽지 않는다.** 저장소와 DB가 프로세스
안에 있다(ADR-0007). 패널에 남아 있어도 무해하다(env 스킴이 모르는 키는 무시한다).

프로퍼티처럼 동작하는 하드코딩 상수(설정 아님 — 바꾸면 계약 변경):
프로토콜 버전 1, 하트비트 30s/타임아웃 90s, 방 TTL 40분, 빈 방 유예 30s/게임 중
10분, 턴 25s+유예 1s, 오프라인 허용 2턴, 게스트 24h/회원 30d, 스위퍼 5분,
저장소 만료 키 회수 60초, 저장소 키 수 상한 10만(넘으면 새 키 거절).

## 부팅 배선 (`server.ts` / `main.ts`)

`createServer`는 **조립만** 한다(DESIGN.md 「코드 구조」). 배선표가 여기 있는 이유는
이 저장소에서 **배선 누락이 반복된 실패 모드**이기 때문이다: 타입이 맞고 빌드·단위
테스트도 통과하는데 런타임에 조용히 아무 일도 일어나지 않는다. 실제로 겪은 다섯 번은
① 봇 라우트가 브로드캐스터를 못 받아 404 ② 게임 모듈 레지스트리가 갈라져 훅 미실행
③ 라운드 타이머가 다른 브로드캐스터를 받아 방송이 허공으로 ④ 퀵매치 presence가 다른
레지스트리라 자동 시작이 영구 거짓 ⑤ 운영 라운드 저장소가 인메모리(재시작마다 진행 중
게임 소실)다. 그래서 **`src/__tests__/serverWiring.test.ts`가 배선 자체를 회귀
테스트로 고정한다** — 판정 기준은 "타입이 맞는가"가 아니라 "배선을 빼면 이 테스트가
깨지는가"다.

### 공유 인스턴스 (새로 만들면 조용히 깨진다)

| 인스턴스 | 받는 쪽 |
|---|---|
| `RoomBroadcaster` | WS 게이트웨이 · 봇 REST · 라운드 타이머·해소기 · 게임 종료 · 야추·듀얼·탁구 모듈 |
| `RoomSessionRegistry` | WS 게이트웨이 · 라운드 타이머(presence) · 게임 종료(markPhase) · 세 게임 모듈 · **퀵매치(자동 시작 조건)** |
| `RealtimeRoomSnapshotService` | WS 게이트웨이 · 봇 REST · 게임 종료 · 재접속 스냅샷 · 세 게임 모듈 |
| `GameModuleRegistry` | WS 게이트웨이(`handleGameMessage`·이탈 훅) · `GameLifecycleService`(REST 시작) |
| `InMemoryRoundDeadlineScheduler` | 라운드 타이머 · 게임 종료(`cancelRoom`) · 듀얼·탁구(상태 `version` 키) |
| `GameCompletionService`(2.7) | 라운드 타이머(`gameCompletion`) · 듀얼 · 탁구 — **전부 `force=true` 경로** |
| `CachingWeeklyRankingRepository`(4.5) | 랭킹 서비스(읽기) · 전적 보관(4.4)의 `rankingCache`(evict) |

- 라운드 상태 저장소는 **`RedisYachtDiceStateStore`**(3.1)다. 이름의 "Redis"는 Redis 명령
  모양을 쓴다는 뜻이고, 실제 저장소는 프로세스 안의 `MemoryRedis`다. `InMemoryRoundStateStore`는
  2.4가 남긴 테스트 시드다 — 원자적 스크립트·TTL을 거치지 않으므로 운영에 두지 않는다.
- 4.4의 포트 이름이 4.5의 구현과 다르다(`RankingCacheInvalidator.invalidateAll` ↔
  `WeeklyRankingCacheEvictor.evictAll`) — 배선에 한 줄 어댑터가 있다.
- DB를 타는 배선(4.3 프로필·4.4 전적 보관·4.5 랭킹)은 **풀이 lazy라 DB 파일을 열지 않고도
  조립·기동이 성공한다**(파일은 첫 질의 때 연다). 전적 보관 실패는 2.7이 삼켜
  `onArchiveFailure` 로그로 흘리므로 게임 종료는 그대로 진행된다.

### 등록되는 REST 라우트 (`/api/v1`)

방·게임(1.4) · 조회(2.9 `scores`·`results`·`score-candidates`) ·
프로필(4.3 `users/me`) · 퀵매치(3.5) · 랭킹(4.5) · 소셜 로그인(4.2). 헬스·메트릭은
프리픽스 밖(`/actuator/*`)이다. **등록하지 않으면 404이고 컴파일·단위 테스트는 전부
통과한다** — 라우트별 고유 오류 표면(503/401 `unauthorized`/401 `session_expired`/
JSON `AUTH_FAILED`)이 곧 "배선됐는가"의 판정이다.

### 기동 순서

1. `main.ts`: env 로드 → DB 풀 생성(파일은 아직 열지 않는다) → `createServer(env, { db })`
2. `server.listen()`:
   `resumeGamesOnStartup`(진행 중이던 판을 저장된 마감으로 재무장, 실패한 방만 폐쇄) →
   `OrphanedRoundStateSweeper.start()`(5분 주기) → `app.listen(SERVER_PORT)`
   - **재무장이 `app.listen`보다 먼저인 것이 계약이다.** 요청을 받기 시작한 뒤에
     되살리면 그 사이 도착한 재접속이 아직 비어 있는 마감을 보고 실패한다.
   - 저장소는 `main.ts`가 `createServer`보다 먼저 스냅샷에서 들여 둔다(`infra/storeSnapshot.ts`).
     그래야 이 단계가 되살릴 방을 본다.
   - 스위퍼는 프로세스가 살아 있는 동안 생기는 고아 라운드 상태를 치운다.

### 종료 훅 (`server.close()`, SIGTERM·SIGINT)

`heartbeat.stop()` → `closeScheduler.stop()`(빈 방 폐쇄 예약) →
`sweeper.stop()` → `deadlineScheduler.stop()`(라운드·듀얼·탁구 마감 예약) →
`gateway.close()` → `app.close()` → (주입받지 않았다면) 저장소·DB 종료.
**주입한 쪽이 닫는다**: `main.ts`가 넘긴 풀은 `main.ts`가 닫고, 통합 테스트가 넘긴
저장소는 하네스가 닫는다. 인메모리 예약을 먼저 끊는 이유는 unref된 타이머가 남으면
닫힌 저장소·DB를 두드리기 때문이다(테스트에서는 스위트 간 누수가 된다).

## 모니터링

- `GET /actuator/health` — **readiness다.** 준비됐으면 200 `{"status":"UP"}`,
  아니면 503 `{"status":"DOWN"}`이다. 경로와 본문 형식은 계약이므로 배포 검증·모니터링과
  함께서만 바꾼다.
  - 판정 근거는 저장소 `PING`(`redis`) + DB `SELECT 1`(`db`)이다(`monitoring/readiness.ts`).
    확인 하나에 2초 상한이 있고, 판정은 5초 캐시하며 동시 호출은 같은 확인 하나로
    합류한다. 저장소가 프로세스 안이라 사실상 DB 파일을 열 수 있는가를 본다.
  - **어느 의존이 죽었는지는 본문에 싣지 않는다**(인증 없이 공개되는 표면이다).
    진단은 로그에 있고, 판정이 **바뀔 때만** 한 줄 남는다(`readiness UP` /
    `readiness DOWN` + 실패한 확인 이름).
  - 판정기를 배선하지 않으면 이 엔드포인트는 **항상 503이다.** 배선 누락이 조용한
    초록이 되지 않게 하는 방향이다(prometheus 라우트와 같은 규약).
  - 기동과 준비는 다른 사건이다: DB 파일을 열 수 없어도 `listen()`은 성공하고 같은
    상태에서 health는 503이다. 진행 중인 게임은 DB 없이도 굴러가지만 로그인·랭킹은
    즉시 실패하므로 DOWN이 맞다 — readiness는 "게임이 안 끊겼다"가 아니라 "이
    인스턴스가 자기 계약을 전부 이행할 수 있다"는 뜻이다.
  - 소비자는 CI의 번들 리허설(`botkeep.yml`·`fullstack.yml`이 UP을 기다린다)과 외부
    uptime 체크다.
- `GET /actuator/prometheus` — 노출 메트릭(이름·태그가 계약):
  - `yorr_rooms_active` (gauge): 인메모리 phase가 PLAYING인 방 수
  - `yorr_game_participants_active{game="YACHT_DICE"|...}` (gauge): PLAYING
    방에서 **라이브 소켓**을 가진 플레이어 수(오프라인 좌석 제외). 태그 값은
    대문자 게임 코드(WS 네임스페이스와 달리 소문자화하지 않는다)
  - ⚠️ **`yorr_rooms_active`는 지금 거짓값을 낸다.** 게임 중 접속이 끊기면 좌석이
    남고, 좌석이 남는 동안 방을 닫는 경로가 실행되지 않아 인메모리 phase가 영구히
    `playing`에 머문다(저장소의 방 데이터는 TTL로 사라진다). 고치기 전에는
    대시보드·알림에 쓰지 않는다. `yorr_game_participants_active`는 신뢰할 수 있다.
  - **지금은 아무도 긁지 않는다.** OCI 호스트의 Alloy 에이전트가 사라졌고, Botkeep
    무료 플랜에는 에이전트를 함께 띄울 자리가 없다. 필요해지면 외부 스크레이퍼가 이
    경로를 직접 긁게 한다.
- 그 외 액추에이터 엔드포인트는 노출하지 않는다(health·prometheus만) —
  `env`·`beans`·`metrics`처럼 방·세션 정보가 인증 없이 새는 표면을 늘리지 않는다.
- 메시지 레이트·지연·소켓 수 계측은 없다 — 추가는 자유지만 위 두 개는 유지.

### Node 구현 (5.3)

- 두 라우트 모두 `http/routes/health.ts`(`registerHealthRoutes(app, { metrics })`).
  게이지 수집기는 `monitoring/realtimeGameMetrics.ts`(`RealtimeGameMetrics`, 텍스트 렌더러는
  `monitoring/exposition.ts`.
- **수집 출처는 WS 레지스트리의 인메모리 상태**다(`RoomSessionRegistry.activeRoomCount()`
  ·`activeParticipantCount(code)`). **저장소를 훑지 않는다** — 스크레이프
  주기마다 SCAN을 던지면 모니터링이 부하 원인이 된다. 단일 인스턴스 전제(DESIGN.md 원칙 8)
  라 phase·소켓이 인메모리에 있어 이 값이 곧 이 프로세스의 진실이다.
  - 계열(태그 조합)은 `GameModuleRegistry.supportedCodes()`(= 카탈로그) 전체이며,
    값이 0인 게임도 줄을 낸다(계열이 사라지면 대시보드가 끊긴다).
  - 스크레이프 시점에 세는 **pull 게이지**다. 증감 카운터를 따로 들지 않는 이유는
    offline 전이·소켓 교체·방 폐쇄 중 한 곳만 빠뜨려도 값이 조용히 어긋나기 때문이다.
- 노출 형식은 Prometheus 텍스트 0.0.4(`# HELP`·`# TYPE` 포함), Content-Type
  `text/plain; version=0.0.4; charset=utf-8`.
- **의존성 0**이다 — `prom-client`를 쓰지 않는다. 노출 대상이 게이지 둘뿐이고
  (histogram·summary 없음) 형식이 `name{tag="v"} value`라 렌더러가 40줄이다
  ([ADR-0003](../adr/0003-node-fastify-stack.md)의 기조). 계약은 **이름·태그**이므로
  스크레이퍼가 보는 것은 같다. 집계가 필요한 계측(지연 히스토그램 등)이 생기면 그때
  별도 티켓으로 `prom-client`를 도입하고 `exposition.ts`를 대체한다.
- `metrics` 배선이 없으면 `/actuator/prometheus`는 **404가 아니라 503**이다(auth
  라우트의 미설정 503과 같은 규약). 스크레이프가 빈 본문으로 조용히 성공하는 것이
  이 저장소의 상습 실패 모드(배선 누락)에서 최악이라서다.
- 테스트: 값·형식은 `monitoring/__tests__/metrics.test.ts`(가짜 소켓으로 PLAYING·오프라인
  전이·재접속을 만들어 숫자 변화를 고정), 경로 표면은
  `http/routes/__tests__/metrics.test.ts`(health 응답·Content-Type·다른 액추에이터 경로 404).

## 배포 (Botkeep)

절차는 [`deploy/botkeep/README.md`](../../../deploy/botkeep/README.md)가 정본이다. 여기에는
배포물과 파이프라인의 계약만 적는다.

### 배포물

`npm run build:botkeep`(`backend/scripts/build-botkeep.mjs`)이 `deploy/botkeep/out/`에 두 파일을
만든다 — 런타임 의존성까지 품은 esbuild 번들 `yorr.mjs`와, `engines`(Node ≥ 22.13)·시작 명령만
든 `package.json`. Botkeep에서 `npm install`이 할 일이 없다.

- 시작 명령은 `node --max-old-space-size=128 --max-semi-space-size=2
  --disable-warning=ExperimentalWarning yorr.mjs`다. 패널에는 **npm을 거치지 않고** 이것을
  그대로 넣는다(`npm start` 래퍼가 RSS 약 65MB를 따로 쓴다).
- 번들 머리(banner)는 CJS 의존성의 `require`를 살리고, `SERVER_PORT`가 없으면 `PORT`를 쓴다.

### 파이프라인

| 워크플로 | 하는 일 |
|---|---|
| `backend.yml` | check · typecheck · 단위+통합+커버리지 래칫 · 블랙박스 · build. 서비스 컨테이너 없음 |
| `botkeep.yml` | 번들을 만들어 **패널과 같은 시작 명령으로** 띄우고 블랙박스 스위트를 그 위에 돌린다. RSS를 요약에 남긴다. main에서만 통과한 번들을 `botkeep` 브랜치에 커밋한다 |
| `fullstack.yml` | 같은 번들 앞에 진짜 프론트 빌드를 세우고 브라우저 E2E(e2e/real)를 돌린다 |
| `nightly.yml` | 퍼저 2만 프레임 · 저장소 장애 주입 전수 |

`botkeep` 브랜치에는 번들만 들어가고 소스는 없다. force push 하지 않으므로 브랜치 이력이 곧
배포 이력이고, 패널에서 이전 커밋을 고르는 것이 롤백이다. 패널의 Redeploy는 GitHub 변경을
당기지 않는다 — GitHub 탭에서 당긴 뒤 재시작한다.

### 재시작과 저장소 스냅샷

`main.ts`가 SIGTERM·SIGINT를 받으면 서버를 닫은 **뒤** 저장소를 `STORE_SNAPSHOT_PATH`(기본
`data/store.json`)에 쓰고, 그 사이에도 `STORE_SNAPSHOT_INTERVAL_MS`(기본 60초)마다 쓴다. 기동하면
읽어 들이고 부팅 재무장이 진행 중이던 판을 같은 마감으로 되살린다. 그래서 패널의 재시작·재배포가
방과 게스트 세션을 지우지 않는다(`botkeep.yml`의 「재시작 뒤 방 유지」가 번들로 확인한다). 소켓은
끊기므로 클라이언트는 재접속 절차로 돌아온다. 비정상 종료(강제 kill·OOM)면 마지막 스냅샷 이후만 잃는다.

단일 인스턴스라 무중단 교체는 없다 — 재시작하는 몇 초 동안 접속이 끊긴다.

### 프론트 도메인 전환 (`*.vercel.app` → `https://yorr.site`)

프론트를 Vercel 기본 주소에서 자체 도메인으로 옮기는 것은 **출처(origin)가 바뀌는
일**이다. 쿠키를 쓰지 않으므로(아래 「출처가 바뀔 때 무엇이 깨지는가」) 손댈 곳은
목록 하나와 리다이렉트 주소 하나뿐인데, 둘 다 틀렸을 때 증상이 "CORS 403" 또는
"로그인하면 옛 주소로 튕김" 하나라서 순서대로 확인하는 편이 빠르다.

1. **Vercel**에서 도메인 추가. `yorr.site`와 `www.yorr.site` 둘 다 등록하고 한쪽을
   primary로 두면 나머지는 301이 걸린다 — 브라우저가 실어 보내는 Origin이 하나로
   모이므로 CORS 목록도 하나로 끝난다.
2. **백엔드 `CORS_ALLOWED_ORIGINS`에 `https://yorr.site`.** Botkeep 패널 환경 변수에
   `https://yorr.site,https://www.yorr.site`를 넣는다. **정확 일치**이고 패턴이 아니다(`ws/gateway.ts`의
   `originAllowed`) — 끝의 `/`만 `allowedOrigins()`가 떼 준다.
   www가 목록에 있는 것은 1번의 301을 **실제로는 걸지 않았기** 때문이다: Vercel이
   두 이름을 모두 그대로 서비스하고 있어 브라우저가 실어 보내는 Origin이 둘로
   갈린다. 나중에 한쪽을 primary로 두어 301을 걸면 그때 하나로 줄인다.
3. **`AUTH_FRONTEND_REDIRECT_URI`는 `https://yorr.site/auth/callback`** —
   이것도 패널에 넣는다. 제공자 콘솔에 등록하는 값이 아니라 우리
   서버가 로그인 끝에 보내는 프론트 주소다.
4. **프론트 `VITE_API_BASE_URL`·`VITE_WS_URL`**(Vercel 프로젝트 환경변수)을 새
   백엔드 주소로. `vercel.json`에 `/api` 프록시가 없으므로 절대 URL이어야 하고,
   HTTPS 페이지에서 `ws://`는 브라우저가 차단한다. 이 두 값의 스킴은
   `vite.config.ts`가 **빌드에서** 검사한다(`assertSecureEndpoint`) — Vercel이
   실행하는 빌드가 그것이므로, 평문 주소를 넣으면 배포가 실패하고 산출물이 나오지
   않는다. localhost 대상 평문은 로컬 프로덕션 빌드용으로 허용한다.
5. **카카오 콘솔**: 「플랫폼 > Web > 사이트 도메인」에 `https://yorr.site` 추가.
   구글은 서버 사이드 교환이라 승인된 리디렉션 URI만 보고, JavaScript 원본은
   쓰지 않는다.
6. **두 콘솔의 Redirect URI는 프론트 도메인이다** —
   `https://yorr.site/api/v1/auth/{kakao,google}/callback`. 콘솔이 IP를 받지
   않으므로 프론트로 받고 `frontend/vercel.json`의 rewrite가 그 두 경로만 백엔드로
   넘긴다(#40). 그래서 **백엔드 주소를 바꿔도 콘솔은 그대로**이고 고칠 곳은
   `vercel.json` 하나다. 백엔드가 받는 값(`KAKAO_REDIRECT_URI`·
   `GOOGLE_REDIRECT_URI`)은 콘솔 등록값과 문자 하나까지 같아야 한다(다르면 카카오는
   KOE006). 백엔드를 Botkeep으로 옮기면 `vercel.json`의 rewrite 대상 주소를 새 도메인으로 바꾼다.

#### 출처가 바뀔 때 무엇이 깨지는가

| 항목 | 영향 | 이유 |
|---|---|---|
| 세션 | **전 사용자 로그아웃처럼 보인다** | 세션 토큰이 `localStorage`(origin별)에 있다. 옛 출처의 값은 옮길 방법이 없다 |
| 쿠키 | 없음 | REST는 `credentials` 미사용, 인증은 `Authorization: Bearer`. SameSite·서드파티 쿠키 문제가 생기지 않는다 |
| 초대 링크·QR | 없음 | `window.location.origin`으로 만든다 — 새 도메인에서 자동으로 새 주소가 된다 |
| apex와 www를 **둘 다** 서비스 | 목록에 없는 쪽에서만 로그인이 안 된다 | 301을 걸지 않으면 Origin이 둘로 갈린다. 빠진 쪽에서는 REST가 CORS로 막히고 WS 핸드셰이크가 거절되며, 로그인은 `AUTH_FRONTEND_REDIRECT_URI`(apex)로 되돌아가 세션이 그 출처의 `localStorage`에 저장된다 — 시작한 출처에서는 계속 로그아웃 상태다 |
| Vercel Preview 배포 | 운영 백엔드를 부르면 403 | preview는 배포마다 다른 출처(`yorr-<해시>.vercel.app`)라 정확 일치 목록으로 열 수 없다. 로컬 `dev:real`은 Vite 프록시가 Origin 헤더를 떼서 우회하지만 preview에는 그 우회가 없다 |

## 프론트 개발 모드와의 접점

- `frontend npm run dev:real` / `test:e2e:real`: Vite 프록시가 `/api`·`/ws`를
  백엔드 origin으로 넘긴다(로컬은 `http://localhost:8080`). 프록시가 origin
  헤더를 제거하므로 CORS 기본값으로도 로컬 개발이 된다.
- e2e:real이 계약 검증의 최종 수단이다. 백엔드 기동 감지는
  `POST /rooms`가 **아무 HTTP 응답**이나 주면 성공으로 본다.
