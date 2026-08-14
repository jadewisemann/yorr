# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·제약·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식으로 판정된 항목은 DESIGN.md(또는 docs/design·ADR)로
> 승격하고 여기서 지운다. 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-14 - Phase 4.1 (MySQL 배선)

- **스키마 동결은 관례가 아니라 기계적 제약이다.** Spring Boot의 Flyway는
  `validateOnMigrate: true`가 기본이라 부팅마다 `flyway_schema_history`를 파일
  목록과 대조한다. 전환기에 Node가 새 마이그레이션을 적용하고 이력 행을 쓰면
  backend-java가 "적용됐는데 로컬에 없는 마이그레이션"으로 **다음 부팅에서 죽는다**.
  그래서 기동 경로용 API를 읽기 전용 `verifyMigrations`로 따로 뒀고, 실제로
  적용하는 `runMigrations`는 빈 개발 DB·통합 테스트 전용으로 분리했다(ADR-0005).
- **`mysql2`의 `timezone` 기본값이 잠재 버그였다.** 기본 `'local'`은 Date ↔
  DATETIME 변환에 프로세스 TZ를 쓴다. `backend-java/compose.yaml`의 mysql은
  `TZ: Asia/Seoul`이고 운영은 UTC라, 그대로 두면 같은 코드가 환경마다 9시간
  어긋난 `finished_at`을 쓴다 — persistence.md가 "복구 불가능한 오염"이라고
  적어 둔 바로 그 경로다. 풀에 `timezone: 'Z'`를 못박았다(Java가
  `Clock.systemUTC()`를 명시하는 것과 같은 이유·같은 자리).
- **Flyway 체크섬은 "줄 종결자를 뺀 각 줄의 UTF-8 바이트에 대한 CRC32(signed
  int)"** 다. CRLF/LF 차이·파일 끝 개행·BOM에 영향받지 않는다. `node:zlib`의
  `crc32`(Node ≥22.2)로 의존성 없이 같은 값이 나온다. 우리 계산이 Java와 어긋나면
  Java Flyway가 checksum mismatch로 죽으므로 **불일치를 기본적으로 던지지 않게**
  했다(`validateChecksums`로 승격) — 운영 부팅이 우리 계산 실수로 막히면 안 된다.
- **V1·V2 SQL을 `backend/db/migration/`에 바이트 단위로 복사했다.** 체크섬이
  내용에서 나오므로 한 글자만 달라도 운영 이력과 어긋난다. 두 사본이 같은지
  검사하는 테스트를 뒀고, backend-java가 지워지는 Phase 5에는 자동으로 skip된다.
- **MySQL DDL은 암묵 커밋이라 마이그레이션에 롤백이 없다.** Flyway와 같이 실패한
  마이그레이션도 `success = 0`으로 이력에 남기고 던진다 — 반쯤 적용된 스키마가
  이력에서 안 보이는 것이 가장 나쁜 상태다. 복구는 사람이 그 행을 지우는 것.
- **`multipleStatements`를 켜지 않기로 했다.** 커넥션 전체의 성질이라 마이그레이션
  한 곳 때문에 애플리케이션 풀 전체로 인젝션 피해 범위가 넓어진다. 대신 러너가
  문장을 직접 자른다(문자열·백틱·주석 인식, `DELIMITER`는 미지원 — 던진다).
- ⚠️ **이 환경에 MySQL이 없어 통합 테스트 11개는 한 번도 실행되지 않았다**
  (`mysqld`·`mysql`·`mariadbd` 없음, docker 데몬 소켓 없음). 작성은 됐고 게이트
  동작(`MYSQL_TEST_REQUIRED=1`이면 skip 대신 실패)은 확인했다 —
  **`MYSQL_TEST_URL`이 있는 환경에서 첫 실행이 필요하다.**
- **MySQL 하네스는 ADR-0004(Redis)와 결론이 다르다.** Redis는 테스트가
  `redis-server`를 직접 띄우지만 MySQL은 데이터 디렉터리 초기화가 선행돼야 하고
  배포판마다 다르다. `MYSQL_TEST_URL`이 있으면 쓰고 없으면 skip. 격리는 테스트마다
  `yorr_test_<random>` 스키마 생성·DROP이고, **URL의 데이터베이스 부분은 일부러
  쓰지 않는다**(실수로 개발 스키마를 지우지 않기 위해).
- **미해결 — 4.2 배선에서 정리할 것: `DB_URL` vs `DB_HOST`/`DB_PORT`/`DB_NAME`.**
  Java `application.yaml`은 `url: ${DB_URL}`로 JDBC URL 하나만 받는데 우리
  `config/env.ts`는 셋으로 쪼개 놨다. 운영 `.env` 재사용이 목표이므로 Node가
  `DB_URL`을 파싱하는 쪽으로 맞춘다(음성 `YORR_VOICE_*`와 같은 종류의 함정).
  operations.md 표에 경고를 달아 뒀다.

## 2026-08-14 - Phase 2.2~2.4 (라운드 도메인·스케줄러·스토어)

- **파일 배치는 평평하게 갔다**(`src/game/round/*.ts`). Java의
  `domain/`·`application/port/`·`infrastructure/` 3층은 옮기지 않았다 — 우리
  저장소는 이미 `room/closeScheduler.ts`처럼 **포트 인터페이스와 인메모리 어댑터를
  한 파일**에 두는 관용을 쓴다. 파일 6개짜리 디렉터리에 3층을 만들면 파일보다
  폴더가 많아진다. 2.5~2.8이 같은 폴더에 얹히므로 `index.ts` 배럴로 상위 계층의
  import 표면을 하나로 고정했다.
- **`RoundStateStore` 포트를 전부 async로 만들었다**(Java는 동기). 운영 어댑터가
  Redis이고 `submitAtomically`의 `beforeStateChange`가 곧
  `ScoreConfirmationService.confirm` = CONFIRM_SCORE Lua(2.6)다. 동기 시그니처를
  유지하면 2.6에서 포트를 통째로 다시 바꿔야 한다.
  - 부작용: Java가 `ConcurrentHashMap.compute`의 bin 락으로 공짜로 얻던
    "검증 → 콜백 → 커밋" 원자성이 await 지점에서 깨진다. **방 단위 프라미스 체인
    락**(`withRoomLock`)으로 같은 방의 전이를 직렬화해 메웠다 — 같은 방 동시 제출
    2건에 하나만 성공하는 것을 테스트로 고정했다.
- **마감 스케줄러의 executor 시임을 Node용으로 다시 정의했다**
  (`DeadlineExecutor{schedule(task, delayMs) → {cancel()}}`, 기본 `setTimeout`+`unref`).
  - **Node에서는 슬롯 선등록 레이스가 실제로 재현되지 않는다** — 워커 스레드가
    없어 `setTimeout` 콜백이 `schedule()` 반환 전에 실행될 수 없다. 그래도 Java의
    순서(슬롯 먼저 → executor.schedule)를 **그대로 유지**했다: executor가 주입
    가능한 이상 인라인 실행 어댑터에서는 그 인터리빙이 진짜로 발생하고 회귀
    테스트가 바로 그것을 재현한다. "Node라서 불가능"을 이유로 순서를 뒤집으면
    시임을 갈아끼우는 순간 과거의 탁구 버그가 되살아난다.
  - `vi.useFakeTimers()`로는 이 테스트를 쓸 수 없다(가짜 타이머도 advance 시점에만
    콜백을 부르므로 "schedule() 반환 전 실행"을 만들지 못한다). Mockito 자리에
    손으로 만든 inline/deferred executor를 넣었다 — 실시간 sleep 0.
- **마감·close 작업 시그니처를 `() => void | Promise<void>`로 넓혔다.** Java
  `Runnable`은 동기지만 타임아웃 해소는 Redis를 탄다. 거부는 `onError`로 흘려
  예약기가 죽지 않게 했다(`InMemoryRoomCloseScheduler`와 같은 규약).
- **Java 테스트에 없던 계약 3개를 테스트로 고정했다** — game-modules.md가 계약이라
  적어 둔 것들이라 지금 빠뜨리면 2.5의 removePlayer 경로에서 조용히 깨진다:
  `withoutParticipant`의 (활성 제거 거부 / 인덱스 −1 보정 / 비참가자·finished면
  자기 자신 반환), `recordHold`의 첫 굴림 전 거부, 스토어의 `beforeStateChange` 시맨틱.
- 재현하기로 한 quirk: `RoundSubmission`이 `ScoreCategory`(2.6)를 참조하지 않고
  카테고리 문자열 12개를 **따로 들고 있다**(라운드 → 점수 도메인 의존을 만들지 않는
  경계), `withoutParticipant`가 finished·비참가자에 던지지 않고 자기 자신을 반환,
  `restore`는 참가자 중복·인덱스 범위를 검사하지 않음.
- `RoundSynchronizationError`는 `errors.ts`의 `DomainError`를 **상속하지 않는다** —
  섞으면 라운드 오류가 REST 상태 코드 매핑에 우연히 걸린다.

## 2026-08-14 - Phase 1.7 (음성)

- **음성 명단은 레지스트리 안에 두되 방 명단과 별개 맵이다**(Java와 같음). 방에는
  있는데 마이크만 내려놓은 상태가 정상이라 같은 맵에 섞을 수 없다. 방이 비어
  `forgetRoom`이 도는 시점에 phase·gameCode와 **함께** 버린다 — 방 코드가
  재사용되므로 남겨두면 새 방이 통화 중으로 보인다.
- **정리 순서가 계약이다.** `closed`·`room.leave` 모두 `voice.drop(socket)`을
  분기보다 먼저 부른다. 레지스트리에서 소켓을 지운 뒤에는 소켓만으로 누구였는지·
  어느 방이었는지 알 수 없다. 반대로 하면 남은 사람들이 이미 없는 피어에게 계속
  offer를 보낸다(테스트로 고정).
- **재접속(소켓 교체)은 통화 이탈이 아니다.** `registry.join`이 옛 소켓을 이미
  `bySocket`에서 지웠으므로 늦게 도착한 옛 close의 `voice.drop`은 no-op이 된다 —
  Java에서 `bySession.remove`가 만들던 성질과 같다. 이 성질이 깨지면 새로고침 한
  번에 통화가 끊기므로 회귀 테스트를 넣었다(Java에는 없던 케이스).
- **`voice.signal`의 검사 순서를 Java 그대로 옮겼다**: payload 검증 → 멤버십. 방
  밖에서 깨진 payload를 보내면 `NOT_IN_ROOM`이 아니라 `INVALID_MESSAGE`가 나간다.
  `voice.join`/`leave`는 payload를 파싱조차 하지 않는다. **명단 검증도 하지 않는다** —
  상대가 `voice.join`을 안 했어도 같은 방 멤버면 릴레이된다(대상 조회가 방
  스코프라 다른 방으로는 새지 않는다).
- **환경변수 이름**: Java `application.yaml`에는 voice 항목이 아예 없고
  `@Value("${yorr.voice.*}")` 기본값으로만 존재한다. Spring relaxed binding이 그
  프로퍼티를 읽는 환경변수 이름은 `YORR_VOICE_TURN_SECRET` ·
  `YORR_VOICE_TURN_HOST` · `YORR_VOICE_STUN_URL` · `YORR_VOICE_TURN_TTL_SECONDS`
  이므로(`.`·`-` → `_`, 대문자) 그 이름으로 편입했다. operations.md 표가 적어 둔
  `VOICE_TURN_SECRET` 같은 "제안" 이름으로는 **운영 `.env`가 재사용되지 않는다** —
  문서를 코드에 맞춰 고쳤다.
- **STUN 항목의 null 필드는 생략한다.** Java는 `IceServer`에 `@JsonInclude`가 없어
  Jackson 기본값으로 `"username":null,"credential":null`을 실어 보냈다. 프론트는
  응답을 그대로 `RTCConfiguration.iceServers`에 넘기고 STUN은 두 필드를 보지 않으므로
  동작 차이가 없다고 판정하고 재현하지 않았다.
- HMAC은 Node `createHmac('sha1', secret)` + 표준 base64로 Java
  `Mac("HmacSHA1")` + `Base64.getEncoder()`와 바이트 단위로 같다.

## 2026-08-14 - Phase 1.6 (봇 REST)

- **봇 Lua 2종은 Java 텍스트 그대로 이식**(`room/scripts.ts`의 `BOT_ADD`·`BOT_REMOVE`).
  KEYS 순서가 기존 `roomKeyFamily`(room·players·scores·bots)와 정확히 같아 키 헬퍼를
  그대로 재사용했다.
- **반환 코드 4의 뜻이 두 스크립트에서 다르다** — ADD=정원 초과(`room_full`),
  REMOVE=그런 봇 없음(`bot_not_found`). Java의 `requireSuccess(result, botMustExist)`
  분기를 그대로 옮겼다. 하나로 합치면 REST 상태 코드까지 바뀐다(409 vs 404).
- **봇 API의 오류 매핑은 방 API와 다르다.** `RoomBotController`는
  `IllegalArgumentException` 기본이 **400**이고 `room_not_found`만 404,
  `IllegalStateException` 기본이 409인데 `bot_not_found`만 404다. 공용
  `sendDomainError`(기본 404)를 쓸 수 없어 `sendBotError`를 따로 뒀다.
- **403이 필요해 `ForbiddenError`(Java `SecurityException` 자리)를 새로 만들었다.**
  지금 던지는 곳이 봇 API뿐이라 `room/botService.ts`에 두었다 — 다른 API가 403을
  쓰기 시작하면 `errors.ts`로 승격한다.
- **quirk 재현: 없는 방 + 봇 추가 → 400 `invalid_game_code`.** Java가 존재 확인보다
  게임 레지스트리 조회를 먼저 하기 때문이다. 부수 결론: **404 `room_not_found`는
  방이 Redis에서 사라졌는데 WS 레지스트리에 gameCode가 남아 있는 좁은 창에서만
  나온다** — 실질적으로 도달하기 어렵다. supportsBots 게이트가 읽는 gameCode도
  Redis가 아니라 **실시간 스냅샷**의 값이다(Java와 같은 출처를 일부러 유지).
- **Java의 두 테스트를 통합 테스트로 바꿨다.** `BotParticipantServiceTest`는 Lua
  **텍스트 문자열 비교**였고(조건 하나가 빠져도 통과한다), `RoomBotControllerTest`는
  서비스·브로드캐스터를 모킹했는데 계약의 절반이 "Lua 반환 코드 → HTTP 상태" 매핑이라
  모킹하면 테스트가 매핑을 스스로 정의해 버린다. 진짜 Redis + 진짜 `RoomBroadcaster` +
  가짜 소켓으로 옮겨 방송 프레임(`state.sync`)까지 확인한다.
- `bot_operation_failed`(ADD 반환 5, botId 중복)는 `add()`가 매번 새 UUID를 뽑아
  서비스 API로는 재현이 불가능하다. 반환 코드 자체가 계약이라 테스트는
  `runLuaNumber(BOT_ADD, ...)`로 스크립트를 직접 호출해 5를 고정했다.
- 봇은 사람과 같은 좌석 규칙이다 — 정원 2인 방에 봇 1을 넣으면 사람의 JOIN이
  `room_full`로 막히고, START의 minPlayers도 봇을 센다.
- **봇 라우트는 WS 게이트웨이와 같은 `RoomBroadcaster`·`RealtimeRoomSnapshotService`
  인스턴스를 받아야 방송이 실제로 나간다**(새로 만들면 허공으로 간다). 셋이 다
  있을 때만 라우트를 등록하고 없으면 부팅 warn을 남긴다 — 배선 누락이 조용한
  404로 나타나지 않게 하기 위해서다.

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
