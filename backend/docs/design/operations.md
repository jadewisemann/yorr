# 운영 (환경변수 · 모니터링 · 배포 계약)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `application.yaml`,
> `config/`, `monitoring/`. 배포 파이프라인: 루트 `Jenkinsfile`,
> `deploy/compose.yaml`.

## 환경변수 (backend-java와 이름 동일 유지)

기본값은 `config/env.ts`(zod 스킴)가 정본이다. **필수 변수는 하나도 없다** —
전부 기본값이 있어 빈 환경에서도 부팅된다(운영에서 빠뜨리면 로컬 기본값으로 뜨는
것이 그 대가다).

| 변수 | 기본값 | 용도 |
|---|---|---|
| `DB_URL` | `""` = 미사용 | MySQL 좌표. **Java가 읽는 것은 이것 하나(JDBC URL)다**(`application.yaml: url: ${DB_URL}`). 값이 있으면 `jdbc:` 접두를 벗겨 파싱해 아래 `DB_HOST`·`DB_PORT`·`DB_NAME`을 **덮어쓴다** — 운영 `.env`가 그대로 재사용된다(4.2에서 정렬 완료). 쿼리 파라미터(`serverTimezone` 등)는 일부러 버린다 |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `localhost` / `3306` / `yorr` | `DB_URL`이 없을 때 쓰는 쪼갠 좌표. Node·로컬 `.env.example` 전용이며 Java에는 대응이 없다 |
| `DB_USERNAME` / `DB_PASSWORD` | `yorr` / `""` | MySQL 자격. **URL 안의 userinfo보다 이쪽이 이긴다**(Java의 JDBC 프로퍼티와 같은 결론) |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Redis |
| `REDIS_PASSWORD` | `""` | Redis |
| `SERVER_PORT` | `8080` | 리슨 포트 |
| `CORS_ALLOWED_ORIGINS` | `https://yorr.site` | REST·WS 공용 허용 출처(콤마 목록). 기본값이 운영 전용인 것이 fail-safe 설계다 |
| `AUTH_FRONTEND_REDIRECT_URI` | `http://localhost:5173/auth/callback` | 로그인 콜백 후 프론트 복귀 |
| `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET`(선택) / `KAKAO_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 카카오 OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | `""` / `""` / localhost 콜백 | 구글 OAuth |

Java에서 `@Value`로만 존재해 yaml에 없는 것(환경으로만 주입) — Node에서는
env.ts에 정식 편입한다(1.7에서 완료). **이름은 제안이 아니라 Java가 실제로 읽는
것을 그대로 쓴다**: Spring relaxed binding이 `yorr.voice.turn.secret`을 읽는
환경변수 이름은 `YORR_VOICE_TURN_SECRET`이다(`.`·`-` → `_`, 대문자). 다른
이름을 쓰면 운영 `.env`가 재사용되지 않는다.

| 변수 (Java 프로퍼티) | 기본값 | 용도 |
|---|---|---|
| `YORR_VOICE_TURN_SECRET` (`yorr.voice.turn.secret`) | `""` = TURN 미제공 | coturn 공유 시크릿 |
| `YORR_VOICE_TURN_HOST` (`yorr.voice.turn.host`) | `""` = TURN 미제공 | TURN 호스트 |
| `YORR_VOICE_STUN_URL` (`yorr.voice.stun-url`) | `stun:stun.l.google.com:19302` | STUN |
| `YORR_VOICE_TURN_TTL_SECONDS` (`yorr.voice.turn.ttl-seconds`) | `600` | 자격 TTL |

테스트 전용 변수(런타임은 읽지 않는다 — [ADR-0004](../adr/0004-redis-integration-test-harness.md)):

| 변수 | 기본값 | 용도 |
|---|---|---|
| `REDIS_TEST_URL` | 없음 = 테스트가 `redis-server`를 직접 띄운다 | 이미 떠 있는 Redis로 통합 테스트를 돌린다 |
| `REDIS_TEST_REQUIRED` | 없음 | `1`이면 Redis가 없을 때 건너뛰지 않고 실패한다. **파이프라인에 `npm test`를 넣을 때 켠다**(Phase 5) |
| `MYSQL_TEST_URL` | 없음 = 마이그레이션 통합 테스트를 건너뛴다 | 이미 떠 있는 MySQL로 마이그레이션 러너 통합 테스트를 돌린다([ADR-0005](../adr/0005-flyway-compatible-migration-runner.md)) |
| `MYSQL_TEST_REQUIRED` | 없음 | `1`이면 MySQL이 없을 때 건너뛰지 않고 실패한다. **파이프라인에 mysql 서비스와 함께 켠다**(Phase 5) |

프로퍼티처럼 동작하는 하드코딩 상수(설정 아님 — 바꾸면 계약 변경):
프로토콜 버전 1, 하트비트 30s/타임아웃 90s, 방 TTL 40분, 빈 방 유예 30s/게임 중
10분, 턴 25s+유예 1s, 오프라인 허용 2턴, 게스트 24h/회원 30d, 스위퍼 5분.

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

- 라운드 상태 저장소는 **`RedisYachtDiceStateStore`**(3.1)다. `InMemoryRoundStateStore`는
  2.4가 남긴 테스트 시드이며, 운영에 두면 재시작마다 진행 중 게임이 사라지는데 타입은
  맞아서 아무 테스트도 깨지지 않는다.
- 4.4의 포트 이름이 4.5의 구현과 다르다(`RankingCacheInvalidator.invalidateAll` ↔
  `WeeklyRankingCacheEvictor.evictAll`) — 배선에 한 줄 어댑터가 있다.
- MySQL을 타는 배선(4.3 프로필·4.4 전적 보관·4.5 랭킹)은 **풀이 lazy라 MySQL 없이도
  조립·기동이 성공한다.** 전적 보관 실패는 2.7이 삼켜 `onArchiveFailure` 로그로 흘리므로
  게임 종료는 그대로 진행된다.

### 등록되는 REST 라우트 (`/api/v1`)

방·게임(1.4) · 음성(1.7) · 조회(2.9 `scores`·`results`·`score-candidates`) ·
프로필(4.3 `users/me`) · 퀵매치(3.5) · 랭킹(4.5) · 소셜 로그인(4.2). 헬스·메트릭은
프리픽스 밖(`/actuator/*`)이다. **등록하지 않으면 404이고 컴파일·단위 테스트는 전부
통과한다** — 라우트별 고유 오류 표면(503/401 `unauthorized`/401 `session_expired`/
JSON `AUTH_FAILED`)이 곧 "배선됐는가"의 판정이다.

### 기동 순서

1. `main.ts`: env 로드 → MySQL 풀 생성 → `createServer(env, { mysql })`
2. `main.ts`: `verifyMigrations`(**여기서만** MySQL 왕복 — 아래 배포 절 참고).
   실패면 `server.close()` + exit 1.
3. `server.listen()`:
   `closeUnrecoverableGamesOnStartup`(재시작으로 이어갈 수 없는 PLAYING 방 폐쇄) →
   `OrphanedRoundStateSweeper.start()`(5분 주기) → `app.listen(SERVER_PORT)`
   - 스위퍼는 라운드 상태가 Redis에 사는 지금부터 실전에서 필요하다. 인메모리였을
     때는 재시작이 상태를 함께 지워 고아가 생기지 않았다.

### 종료 훅 (`server.close()`, SIGTERM·SIGINT)

`heartbeat.stop()` → `closeScheduler.stop()`(빈 방 폐쇄 예약) →
`sweeper.stop()` → `deadlineScheduler.stop()`(라운드·듀얼·탁구 마감 예약) →
`gateway.close()` → `app.close()` → (주입받지 않았다면) Redis·MySQL 종료.
**주입한 쪽이 닫는다**: `main.ts`가 넘긴 풀은 `main.ts`가 닫고, 통합 테스트가 넘긴
Redis는 하네스가 닫는다. 인메모리 예약을 먼저 끊는 이유는 unref된 타이머가 남으면
이미 닫힌 Redis를 두드리기 때문이다(테스트에서는 스위트 간 누수가 된다).

## 모니터링

- `GET /actuator/health` → `{"status":"UP"}`. 경로 변경은 배포 검증·모니터링과
  함께서만(Phase 5).
- `GET /actuator/prometheus` — 노출 메트릭(이름·태그가 계약):
  - `yorr_rooms_active` (gauge): 인메모리 phase가 PLAYING인 방 수
  - `yorr_game_participants_active{game="YACHT_DICE"|...}` (gauge): PLAYING
    방에서 **라이브 소켓**을 가진 플레이어 수(오프라인 좌석 제외). 태그 값은
    대문자 게임 코드(WS 네임스페이스와 달리 소문자화하지 않는다)
- 그 외 액추에이터 엔드포인트는 노출하지 않는다(health·prometheus만) —
  `env`·`beans`·`metrics`처럼 방·세션 정보가 인증 없이 새는 표면을 늘리지 않는다.
- Java에는 메시지 레이트·지연·소켓 수 계측이 없다 — 추가는 자유지만 위 두 개는 유지.

### Node 구현 (5.3)

- 두 라우트 모두 `http/routes/health.ts`(`registerHealthRoutes(app, { metrics })`).
  게이지 수집기는 `monitoring/realtimeGameMetrics.ts`(`RealtimeGameMetrics` —
  Java `monitoring/RealtimeGameMetrics` MeterBinder 자리), 텍스트 렌더러는
  `monitoring/exposition.ts`.
- **수집 출처는 WS 레지스트리의 인메모리 상태**다(`RoomSessionRegistry.activeRoomCount()`
  ·`activeParticipantCount(code)`). Java도 같았고, **Redis 왕복은 없다** — 스크레이프
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

## 배포 파이프라인 계약 (현재 = backend-java 기준, Phase 5에서 전환)

Jenkins(`pollSCM`, main·develop 분기만):

- 변경 감지가 **`backend-java/**`·`deploy/**`·`Jenkinsfile`에 하드코딩**되어
  있다 — `backend/**`(Node)는 현재 CI/CD에 연결되어 있지 않다. 전환 시 수정
  지점: changeset 패턴(5곳), 빌드 스테이지(gradle bootJar → npm build),
  `docker build` 대상 디렉터리.
- 이미지 태그 `backend:prod`(main) / `backend:dev`(develop),
  컨테이너 `yorr-backend-{main|dev}`, env 파일 `/infra/app/.env.{main|dev}`.
- compose(`deploy/compose.yaml`): 서비스 이름 `backend`(폴더 경로 아님 — rename
  금지), **포트 미공개** — 외부 `app-network`의 리버스 프록시가 별칭
  (`backend-main`/`backend-dev`)으로 접근한다. 설정은 전부 `env_file`로 주입.
  dev 호스트의 `/dev-api`·`/dev-ws` 접두사는 프록시가 벗긴다 — 앱은 항상
  `/api/v1`·`/ws/v1/game`만 서빙한다.
- 배포 검증이 **HTTP 헬스체크가 아니라** `sleep 15` + 컨테이너 Running 확인
  뿐이다. Node 프로세스는 기동 실패 시 즉시 종료(exit≠0)해야 이 검증에
  걸린다 — 설정 오류를 안고 뜨는 것 금지(env.ts의 fail-fast 근거).
- 그래서 **기동 시 마이그레이션 확인이 `main.ts`에 있다**: `verifyMigrations`가
  밀린 마이그레이션·실패 이력 행을 발견하면 로그를 남기고 exit 1로 죽는다
  (읽기 전용 — Node는 스키마를 바꾸지 않는다, [ADR-0005](../adr/0005-flyway-compatible-migration-runner.md)).
  체크섬 불일치와 "이력에는 있는데 파일이 없는 것"은 경고만 남기고 기동한다.
  - **`createServer()`·`listen()`에는 넣지 않는다.** 그 두 경로는 통합 테스트가
    실제로 부르며(`ws/__tests__/gateway.test.ts`), MySQL 없는 개발·CI 환경에서
    WS 테스트 전부가 깨진다. 풀은 `main.ts`가 만들어 `createServer(env, { mysql })`로
    주입하고, 주입한 쪽(`main.ts`)이 닫는다.

Node 백엔드가 슬롯에 들어가기 위한 조건 요약: env 파일만으로 완전 설정,
`SERVER_PORT`(프록시가 기대하는 포트) 리슨, 기동 15초 내 안정, `/api/v1/*` +
`/ws/v1/game` + `/actuator/*` 서빙, Dockerfile 제공.

## 프론트 개발 모드와의 접점

- `frontend npm run dev:real` / `test:e2e:real`: Vite 프록시가 `/api`·`/ws`를
  백엔드 origin으로 넘긴다(로컬은 `http://localhost:8080`). 프록시가 origin
  헤더를 제거하므로 CORS 기본값으로도 로컬 개발이 된다.
- e2e:real이 계약 검증의 최종 수단이다(ADR-0002). 백엔드 기동 감지는
  `POST /rooms`가 **아무 HTTP 응답**이나 주면 성공으로 본다.
