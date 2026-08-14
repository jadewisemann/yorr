# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·제약·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식으로 판정된 항목은 DESIGN.md(또는 docs/design·ADR)로
> 승격하고 여기서 지운다. 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-14 - Phase 1.5 (WS 코어)

- **세션 식별자를 만들지 않았다.** Java는 `WebSocketSession.getId()` 문자열로
  레지스트리·팬아웃·하트비트의 키를 잡는데, Node에서는 **소켓 객체 참조 자체**를
  키로 썼다(`Map<ClientSocket, …>`). id를 발급하면 그 id의 수명을 소켓 수명과
  따로 관리해야 하고, 교체된 옛 소켓의 close가 늦게 도착하는 경로에서 정확히 그
  두 수명이 어긋난다. `ClientSocket`(send/close/readyState)은 `ws`의 WebSocket이
  그대로 만족하고 테스트는 전송 기록만 남기는 가짜를 넣는다 — Java 테스트의
  `mock(WebSocketSession)` 자리다.
- **핸들러를 `ws`에서 떼어냈다**(`ws/handler.ts` = 프로토콜, `ws/gateway.ts` =
  배선). Java 테스트가 `handleTextMessage`를 직접 부르던 것과 같은 구조이며,
  덕분에 26개 프로토콜 테스트가 소켓을 열지 않고 돈다. 실제 소켓 위 검증은
  `ws/__tests__/gateway.test.ts`(인프로세스 서버 + 진짜 `ws` 클라이언트)가 맡는다.
- **소켓별 메시지 직렬화가 필요했다**(gateway). Java는 세션당 한 스레드라 공짜로
  얻던 순서 보장이 async 핸들러에서는 깨진다 — `room.join`이 Redis를 기다리는
  사이 다음 메시지가 먼저 처리되면 순서 계약이 무너진다. realtime.md에 기록.
- **Phase 1에는 게임 모듈이 하나도 없다.** 핸들러가 `module.pause/hasState/
  reconnect/resume/close/removePlayer`를 부르는 자리에 대기실 전용 대역
  (`lobbyOnly`)을 뒀다: `hasState=false`(→30초 유예), `reconnect`는 실시간 병합
  스냅샷. 시그니처는 `RoomGameHooks = Pick<GameModule, …>`라 2.1의 진짜 모듈이
  그대로 들어온다. Java의 `gameModules.require()`처럼 던지게 두면 Phase 1에서
  방이 아예 안 돌아간다.
- **registry의 phase는 Java에서도 게임 모듈이 옮긴다**(`YachtDiceGameModule.start`
  → `markPhase(PLAYING)`). 모듈이 없는 Phase 1에서는 `room.join`이 Redis phase를
  읽어 표시할 때만 갱신되므로, REST로 게임을 시작해도 **이미 붙어 있는 소켓들의
  레지스트리 phase는 waiting에 머문다**(끊기면 offline이 아니라 player_left가
  된다). Phase 2.1에서 모듈이 붙으면 저절로 해소된다 — 지금 별도 경로를 만들면
  2.1에서 두 곳이 phase를 옮기게 된다.
- 하트비트 CAS를 `Map`으로 옮겼다: Java의 2-인자 `remove(key, value)` 자리에
  "지우기 전에 값이 그대로인지 확인"을 둔다. 항목을 먼저 지우고 콜백을 부르므로
  같은 세션에 두 번 실행되지 않는다(멱등 — 테스트로 고정).
- `RoomValidationServiceTest` 때와 같은 판단: Java `RoomSessionRegistryTest`는
  `snapshot().players()` 순서를 보지 않는다(ConcurrentHashMap). 우리 스냅샷도
  **레지스트리 경로는 순서를 보장하지 않고**, 실시간 병합 스냅샷만 playerId
  오름차순이다(그쪽만 프론트가 순서에 기댄다).
- WS 핸드셰이크 origin 검사가 Phase 0 스켈레톤에 없었다 — DESIGN.md 「운영 계약」이
  REST와 같은 목록을 쓰라고 못박고 있어 이번에 붙였다(없으면 REST만 막히고 WS는
  열린 상태). 메시지 크기 상한(64KB)도 realtime.md의 미해결 항목이라 함께 정했다.
- `room.join`의 `registerGame`은 Java와 같이 **던진다**(`invalid_game_code`·
  `room_game_mismatch`). Java에서는 그 예외가 Spring 밖으로 나가 응답 없이 로그만
  남는데, 우리 쪽은 게이트웨이가 잡아 로그를 남기고 소켓을 살려 둔다. 방에
  gameCode가 없는 상태는 우리가 만들 수 없으므로 응답 계약에는 영향이 없다.

## 2026-08-14 - Phase 1.4 (방 REST)

- **헤더 누락은 401로 처리한다**(Java는 Spring `@RequestHeader` 필수 검증에
  걸려 400 + Spring 오류 JSON). 프론트는 두 헤더를 항상 같이 보내므로 실제
  클라이언트에는 차이가 없고, Spring 기본 오류 본문을 흉내 내는 것은 계약이
  아니라 프레임워크 흔적이다 — 재현하지 않기로 결정.
- `GameLifecycleService`를 Phase 2.1보다 먼저 얇게 만들었다. 지금은 카탈로그의
  minPlayers만 읽고 phase를 옮긴다. 모듈 훅(start/reset/removePlayer)이 붙는
  자리를 주석으로 고정해 뒀고 **라우트는 2.1에서 바뀌지 않는다**.
- `POST /rooms`는 `catch (IllegalStateException)`이 아니라 실패 종류로 상태
  코드가 갈린다: `invalid_nickname`·`invalid_game_code`만 400, 나머지
  `DomainError`는 404, `ConflictError`는 409. `errorResponse.ts` 한 곳에 모았다.
- `POST /rooms/{code}/games`는 **ConflictError만** 409로 내린다. 방에 모르는
  gameCode가 적혀 있으면 Java와 같이 500으로 나간다(카탈로그 조회가 던진다) —
  우리가 만들 수 없는 상태라 그대로 뒀다.
- `createServer(env, { redis, logger })`로 Redis를 주입할 수 있게 했다. REST
  통합 테스트가 하네스 Redis 위에서 `app.inject()`로 도는 근거다(모킹 없이
  Lua·TTL까지 같은 경로로 검증된다).

## 2026-08-14 - Phase 1.3 (방 도메인)

- **`RoomCreateService` + `RoomValidationService` → `RoomService` 하나로 합쳤다.**
  둘 다 같은 키 가족을 다루는 얇은 Lua 래퍼였고, Java의 분리는 도메인 경계가
  아니라 파일이 커진 결과로 보인다. 대신 스크립트는 `room/scripts.ts`로 따로
  뺐다 — 계약(반환 코드)이 코드보다 오래 산다.
- `join`은 Java의 `JoinResult(userId, sessionToken, snapshot)` 대신 **스냅샷만**
  돌려준다. 앞의 둘은 호출부(1.4의 `POST /rooms`)가 이미 쥐고 있는 값을 되돌려
  받는 것뿐이었다.
- **`RoomValidationServiceTest`는 스크립트 텍스트를 문자열로 대조하는 테스트**다
  (`assertThat(START.getScriptAsString()).contains("HLEN")`). 그대로 옮기면 Lua를
  포맷만 바꿔도 깨지고 동작은 보증하지 않는다 — 같은 불변식(최소 인원, 자기
  게임만 롤백, 취소 시 게임 키 삭제)을 **실제 Redis 동작 테스트로** 옮겼다.
- `parsePhase`는 알 수 없는 값에 던진다(Java `RoomPhase.valueOf`와 같음). 방
  해시가 있는데 phase가 없는 상태는 우리가 만들지 않으므로 조용히 넘기지 않는다.
- 봇 승계 제외 규칙(LEAVE)은 1.6을 기다리지 않고 검증했다 — `bots` 해시를 직접
  심으면 되고, 그 규칙 자체는 LEAVE Lua의 계약이라 여기 속한다.
- 게임 메타데이터는 `game/catalog.ts`(정원·minPlayers·supportsBots)로 먼저 옮겼다.
  Phase 2.1에서 실제 `GameModule` 레지스트리가 이 표를 흡수한다 — 두 곳이
  값을 따로 들고 있으면 정원이 어긋난다.

## 2026-08-14 - Phase 1.1·1.2 (Redis 배선 · 세션)

- **테스트 하네스는 redis-server spawn으로 결정**(ADR-0004). 파일마다 유닉스
  소켓 인스턴스 하나 — vitest 병렬 실행과 `FLUSHALL`이 양립한다. `--port 0`은
  TCP를 안 열겠다는 뜻이라 포트 충돌이 원천적으로 없다.
- Java `hash()`는 SHA-256을 **표준 Base64**(패딩 있음)로 인코딩하는데 토큰
  자체는 base64url 무패딩이다. 키 이름(`user:token:{hash}`)에 `+`·`/`·`=`가
  들어가지만 Redis 키에는 문제가 없다 — 그대로 옮겼다(다르게 인코딩하면 기존
  세션이 전부 무효가 된다).
- `authenticateCredentials`는 성공할 때만 두 키의 TTL을 민다. 실패 경로에서
  TTL을 건드리지 않는 것이 계약이라 테스트로 고정했다(60초로 줄여 둔 뒤 인증
  → 다시 늘어나는지).
- Java의 `IllegalArgumentException(코드문자열)` 관용은 `DomainError`(src/errors.ts)로
  옮겼다. `SessionAuthenticationError`가 그 하위 타입인 것이 1.4에서
  "컨트롤러의 일괄 catch → 401" 경로를 재현하는 근거가 된다 — 상속 관계를
  깨면 오류 계약이 조용히 바뀐다.
- `UserService.assignRoom`은 hset 후 타입에 맞는 TTL을 **다시** 건다. 이 한 줄이
  없으면 회원이 방에 들어가는 순간 24시간짜리로 강등된다(Java 주석에 명시).
  회귀 테스트를 함께 이식했다.

## 2026-08-14 - 설계 문서 상세화 (backend-java 전수 분석)

- **GAME_SESSION_INTEGRATION.md는 명세가 아니다.** 실제 계약과 프로토콜이
  다르다(`room.subscribe`/`room.snapshot`/`POST /users/guests`/`POST
  /rooms/{code}/players`는 존재하지 않음). Phase 0 설계 문서가 이 문서를
  기반으로 작성돼 있던 것을 코드·테스트·`wsEvents.ts` 기준으로 전면 교정했다.
  backend-java 제거 시(P5) 이 문서도 같이 지운다.
- **envelope 관용 범위 확정**(Phase 0의 미해결 항목): Java는 알 수 없는 필드
  무시, `ts`는 nullable로 받고 사용하지 않음, payload는 raw JSON. 단 `type`
  필드가 없으면 NPE(오류 응답 없음). **결정: NPE quirk는 재현하지 않는다** —
  Node는 `type` 부재를 `INVALID_MESSAGE`로 처리(realtime.md에 기록). 현재
  zod 스키마가 `ts`·`payload`를 필수로 요구하는 것은 실제 클라이언트(항상
  둘 다 전송)와 호환 — 유지.
- **배포된 dev 서버 ≠ 저장소 backend-java.** 프론트 e2e 하네스가 "실서버는
  한글 닉네임을 400 invalid_nickname으로 거부"라고 기록했지만, 저장소의
  `UserService.normalizeNickname`은 trim 후 1~20자만 검증한다(한글 허용).
  배포 서버가 구버전인 것으로 추정 — 명세는 저장소 코드다. Phase 1 e2e:real
  검증 시 대상 서버 버전 주의(PLANS.md 리스크에도 기재).
- Phase 0 스켈레톤과 Java의 어긋남 두 곳, Phase 1·2에서 정렬 필요:
  ① `ws/registry.ts`가 room.subscribe 모델 기준 → room.join 계약으로 재작업,
  ② `game/module.ts`의 GameModule 시그니처(`start(roomId)` 등)가 Java와 다름
  (`start(roomCode, game)`·`reconnect→스냅샷` — game-modules.md 표가 정본).
- 야추 `dice.broadcast`의 `held`는 사람 굴림일 때 **클라이언트가 보낸 값의
  에코**다(서버 상태가 아니라). autoRoll만 서버 activeHeld를 쓴다 — 이식 시
  헷갈리기 쉬운 비대칭이라 메모.
- Java 테스트 스캐폴딩 중 재사용 가치가 큰 것: `GameWebSocketHandlerTest`의
  메시지 빌더들(정본 와이어 예제), `FakeRoomCloseScheduler`(유예 동기 실행),
  `InMemoryRoundDeadlineSchedulerTest`의 인라인 executor(레이스 재현).

## 2026-08-14 - Phase 0 백본

- `.env` 로딩은 dotenv 대신 Node 22 내장 `process.loadEnvFile()` 사용. 파일이
  없으면 던지므로 `existsSync` 가드를 둔다.
- biome은 프론트 설정을 따르되 `lineEnding`만 `lf`로 했다(서버는 Linux 컨테이너
  전제). 프론트는 `crlf`를 쓴다.
