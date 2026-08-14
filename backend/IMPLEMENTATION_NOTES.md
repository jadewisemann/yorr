# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·제약·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식으로 판정된 항목은 DESIGN.md(또는 docs/design·ADR)로
> 승격하고 여기서 지운다. 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-14 - Phase 2.1 (게임 모듈 프레임워크)

- **모듈 부재를 오류가 아닌 정상 상태로 정의했다.** Java `GameModuleRegistry.require()`는
  등록되지 않은 코드에 `invalid_game_code`를 던지고 WS 핸들러가 그걸 그대로 타지만,
  우리 카탈로그에는 세 게임이 다 있고 **모듈은 게임 슬라이스(3.1 야추, 3.x duel·pingpong)가
  하나씩 채운다.** 그대로 던지게 두면 모듈 없는 게임의 방은 대기실조차 돌지 않는다.
  - 그래서 조회를 둘로 쪼갰다: `require(code)` = 카탈로그 메타데이터(모르는 코드는 throw),
    `byCode(code)` = 등록된 모듈 또는 `undefined`(**던지지 않음**).
  - `dispatch`는 모듈이 없으면 `false` → 게이트웨이가 `INVALID_MESSAGE`로 응답한다.
    Java는 예외가 Spring 밖으로 나가 **응답이 아예 없다** — 우리 쪽이 프론트에 더 안전하고,
    "모르는 이벤트"와 같은 응답이라 계약도 넓어지지 않는다.
  - WS 핸들러의 `lobbyOnly` 대역은 **없어지지 않았다.** 이름만 `moduleless`로 바꾸고
    "Phase 1에는 모듈이 없다" → "이 게임의 모듈이 아직 없다"로 의미를 재정의했다.
    `hasState=false`(30초 유예) + 실시간 병합 스냅샷 재접속은 그대로다.
    **세 게임의 모듈이 모두 등록되면 이 대역은 도달 불가가 된다** — 그때 지운다.
- **메타데이터를 모듈에서 뺐다(Java와 의도적으로 다름).** Java `GameModule`은
  `name`/`minPlayers`/`maxPlayers`/`supportsBots`를 default 메서드로 들고 있는데,
  1.3이 이미 같은 값을 `GAME_CATALOG`로 옮겨 놨다(REST 방 생성 정원·봇 게이트가 그걸 쓴다).
  둘을 다 두면 3.1이 모듈에 정원을 다시 적는 순간 조용히 갈라진다. **레지스트리가
  카탈로그를 흡수**(생성자 주입, `require`/`canonicalCode`/`supportedCodes` 위임)하고
  모듈은 `code` + 동작만 선언한다. `register()`는 카탈로그에 없는 코드를 기동 실패로 막는다.
- **`GameLifecycleService` 생성자에 세 번째 인자(레지스트리)를 옵셔널로 붙였다.**
  `(rooms, catalog)`만으로도 지금과 똑같이 돌아가서 `server.ts`(오케스트레이터 소유)를
  건드리지 않고 컴파일이 유지된다. **배선이 안 되면 REST로 시작한 게임의 모듈 훅이
  하나도 돌지 않는다** — 아래 「오케스트레이터 조치」 참고.
- **롤백 실패는 Java 그대로 원인 예외를 대체한다.** `module.start` 실패 → `rollbackStart`
  가 또 던지면(Redis 장애) 그 예외가 올라가고 진짜 원인은 사라진다. 삼키고 원인을
  올리는 쪽이 진단에는 낫지만 REST 상태 코드(500)는 어느 쪽이든 같아서 **재현하기로**
  했다(조용한 개선 금지).
- **`handle` 예외는 잡지 않는다.** 게이트웨이(`ws/gateway.ts`)의 직렬화 큐가 이미
  잡아 로그를 남기고 소켓을 살려 두므로 Java(`handleTextMessage` 밖으로 나가는 예외)와
  결과가 같다. 모듈이 자기 오류 응답을 직접 보내는 것이 계약이다 — 3.1이 지켜야 한다.
- **`handle(socket, ...)`의 socket 타입은 `ws`의 `WebSocket`이 아니라 `ClientSocket`이다**
  (Phase 0 스켈레톤은 `ws` WebSocket을 직접 썼다). 1.5가 핸들러를 `ws`에서 떼어낸 결정과
  같은 이유이고, 이 덕분에 모듈 테스트도 소켓을 열지 않고 돈다.
- **`reconnect`의 반환 타입을 `unknown` → `WsRoomSnapshot`으로 좁혔다.** 1.5의 대역이
  이미 실시간 병합 스냅샷을 돌려주고 있었고, 게임 상태는 그 안의 `game` 필드다.
- `gameWsType`(Java `GameWsTypes.type`)을 `game/module.ts`로 올렸다 — 2.5가
  `round/roundPorts.ts`에 임시 사본을 두면서 "2.1이 올리면 그쪽으로 승격하고 여기서
  지운다"고 적어 뒀다. 우리 것은 `DomainError('invalid_game_event_type')`을 던지고
  2.5 사본은 평범한 `Error`다 — **중복 제거는 후속 작업**(아래).
- 테스트에서 발견: `RETURN_TO_LOBBY` Lua는 **FINISHED에서만** 통과한다(PLAYING에서
  부르면 no-op). 라이프사이클 테스트가 phase를 직접 FINISHED로 심는 이유이고,
  게임 종료(2.7)가 붙기 전까지 `returnToLobby`는 REST로 도달 가능한 경로가 아니다.
- **1.5가 남긴 registry phase 구멍은 아직 열려 있다.** Java는
  `YachtDiceGameModule.start`가 `registry.markPhase(PLAYING)`을 부른다 —
  그건 모듈 안이므로 **3.1이 채워야 한다**(2.1에서 별도 경로를 만들면 phase를 두 곳이
  옮기게 된다). 그때까지 REST로 시작한 게임은 이미 붙어 있는 소켓의 레지스트리 phase가
  waiting에 머물고, 끊기면 offline이 아니라 player_left가 된다.
- 문서: `docs/design/game-modules.md`의 「GameModule」·「레지스트리와 메시지 라우팅」·
  「GameLifecycleService」 세 절만 고쳤다. 맨 아래 「불변식」의
  "게임 추가 시 손댈 곳: `game/<게임>/` 구현 + 레지스트리 등록"은 이제
  **"+ 카탈로그 행 추가"** 가 빠져 있다 — 공유 절이라 손대지 않았으니 오케스트레이터가
  한 줄 보태 주면 좋겠다.

# Phase 2.5 작업 노트

## 2026-08-14 - Phase 2.5 (라운드 타이머·타임아웃)

- **Java가 구체 타입으로 잡던 협력자 6개를 전부 좁은 포트로 뒤집었다**
  (`round/roundPorts.ts`): `RoundBroadcaster`·`RoundPresence`·`RoundRoomService`·
  `GameCompletionPort`(2.7)·`ScoreRoundSubmissionPort`(2.6)·`OpenCategoriesPort`(2.6).
  이유는 둘이다: ① 2.1이 `game/module.ts`·`lifecycle.ts`를, 2.6·2.7이 점수·종료를
  **동시에** 고치고 있어 구체 import는 그대로 병합 충돌이자 컴파일 파손이고,
  ② game-modules.md의 "도메인 규칙은 전송 계층을 모른다"를 Java는 이미 어기고 있다
  (`RoundTimerService`가 `ws.RoomBroadcaster`·`RoomSessionRegistry`를 직접 잡는다).
  - 대가: 어댑터가 없으니 시그니처가 어긋나도 **배선하는 순간(server.ts)에야** 터진다.
    그래서 `__tests__/roundPorts.contract.test.ts`가 진짜 `RoomBroadcaster`·
    `RoomSessionRegistry`를 포트에 대입하고 실제로 호출까지 해 본다. `RoomService`는
    Redis 없이 만들 수 없어 타입 수준 조건부(`extends`)로만 확인한다.
- **2.6과의 이음매를 실측으로 확인했다**(임시 파일 + `tsc --noEmit`, 커밋 안 함):
  `RoundSynchronizationService` → 2.6 `RoundSubmitPort<RoundSubmissionResult>`,
  2.6 `ScoreRoundSubmissionService` → 내 `ScoreRoundSubmissionPort`,
  2.6 `ScoreConfirmationService` → 내 `OpenCategoriesPort`. **셋 다 어댑터 없이 대입
  가능**하다. 우연이 아니라 양쪽이 같은 Java 시그니처를 봤기 때문인데, 지금은 서로
  import하지 않으므로 **한쪽이 이름을 바꾸면 조용히 어긋난다** — 2.6이 머지된 뒤
  배선 티켓에서 이 대입을 진짜 테스트로 고정해야 한다(오케스트레이터 조치 항목).
- **전 경로가 async가 됐다**(`start`·`advanceTurn`·`removePlayer`). Java `start`는
  `Instant`를 그냥 돌려줬지만 `roomService.getSnapshot`(오프라인·봇 판정) ·`touch`·
  `leave`가 전부 Redis다. 2.3이 마감 작업을 `() => void | Promise<void>`로 넓혀 둔
  덕에 스케줄러 쪽은 손대지 않았다. `Instant` 자리는 epoch ms 숫자로 통일했다.
- **`RoundTimeoutResolution`을 판별 유니온으로 바꿨다.** Java는
  `record(kind, advanced, rolled)`로 **둘 중 하나만 채우고 나머지는 null**이라
  kind를 보지 않고 꺼내면 NPE다. 정적 팩터리 3개가 그 규약을 런타임으로 지키던 것을
  타입으로 올렸다 — 동작은 같고, 잘못된 접근이 컴파일에서 막힌다.
- **타이머가 해소기를 `RoundTimeoutResolverPort`로 잡는다.** TS에서 private 필드를
  가진 클래스는 명목 타입이라 Java 테스트의 `mock(RoundTimeoutResolver.class)` 자리에
  구조적 스텁을 넣을 수 없다. 포트를 하나 두는 것이 테스트 전용 서브클래스보다 싸다.
- **재현하기로 한 quirk**: ① 마감 유예 1초 뒤에야 강제 진행하지만 클라이언트에는
  진짜 마감(+0초)을 알린다 ② 오프라인 스킵된 턴은 `roomService.touch`를 하지 않는다
  (그 턴은 진행이 아니므로 방 TTL도 밀지 않는다 — Java와 같음) ③ `room.player_left`만
  게임 네임스페이스가 붙지 않는다 ④ 카테고리 선택의 `Math.floorMod` 접기.
- **재현하지 않기로 한 것 2개(둘 다 관측 동작 동일)**:
  - 해소기의 STALE 판정에 `finished`를 추가했다. Java는 종료된 게임에서 한 번 더
    자동 제출을 시도했다가 `GAME_ALREADY_FINISHED`로 튕겨 같은 STALE에 도달한다.
    부수효과는 양쪽 다 없다(라운드 검증이 `beforeStateChange`보다 먼저라 점수는
    기록되지 않는다). 스토어의 `isStaleTurn`이 이미 `finished`를 스테일로 보므로
    해소기만 다르게 두는 것이 오히려 불일치다.
  - `score.update` 방송 전에 `result.score !== null`을 확인한다. Java는 무조건
    `result.score().playerId()`를 부르므로 점수가 null이면 NPE인데, 그 경로는
    `ScoreRoundSubmissionService`가 성공했을 때만 도달하므로 실제로는 안 난다.
- **`log.warn`을 훅으로 뺐다**(`onDegraded`·`onWarning`). 강등 경로 4가지(주사위 없음·
  게임 못 찾음·족보 조회 실패·자동 기록 실패)와 "라운드 상한인데 종료 전이 실패"는
  조용히 지나가면 안 되는데, 로거를 주입하면 라운드 도메인이 로깅 설정에 묶인다.
  훅이면 테스트가 그 가지를 도달했는지 직접 검증할 수 있다(실제로 검증한다).
- **`seededDieRoller`(mulberry32)를 추가했다** — Java에는 없다. Java 테스트는
  `() -> 1`·`() -> 6` 상수 공급자만 써서 "다섯 개가 전부 같은 값"인 판만 만든다.
  킵 유지·족보 계산처럼 주사위 분포에 기대는 회귀는 그 시임으로는 못 잡는다.
- ⚠️ **Java에 없어서 새로 쓴 테스트 8개가 오프라인·이탈 경로를 처음으로 덮는다**
  (Java `RoundTimerServiceTest`는 `mock(RoundSynchronizationService)`를 넣어 그 경로를
  아예 실행하지 않는다): 오프라인 1턴 스킵, 2턴 자동 퇴장(전 체인), 재접속 카운터
  리셋, 봇은 오프라인 아님, 활성 플레이어 이탈, 멱등 재이탈, 마지막 참가자 이탈.
- **2.1 머지 후 정리 완료(`248bb3b`)**: 작업 중 `roundPorts.ts`에 임시로 두었던
  `gameWsType`·`YACHT_DICE_CODE` 사본을 지우고 `game/module.ts`의 `gameWsType`과
  `game/catalog.ts`의 `YACHT_DICE`를 import한다. 사본을 남기면 WS 접두사 규칙이 두
  곳에서 갈라지고(2.1 쪽은 `DomainError`, 사본은 평범한 `Error`를 던졌다) 게임이
  늘어날 때 조용히 어긋난다. 배럴(`round/index.ts`)에서도 두 이름의 재수출을 뺐다 —
  이제 그 둘의 소유자는 `game/`이다.
- **미해결 — `RoundStartedEvent`의 수신자가 아직 없다.** Java는 Spring
  `ApplicationEventPublisher`로 봇 오케스트레이터(3.2)에 턴 시작을 알린다. 지금은
  `onRoundStarted` 콜백 하나라 구독자가 여럿이 되면 리스너 목록이 필요하다 —
  3.2가 붙을 때 결정한다(그때까지 하나로 충분).

# notes — Phase 2.6

## 2026-08-14 - Phase 2.6 (점수 파이프라인)

- **CONFIRM_SCORE Lua 반환 코드 10종이 이 티켓의 진짜 계약이다.** Java 텍스트를
  그대로 옮겼고 가드 사다리 순서도 바꾸지 않았다(`src/game/score/scripts.ts`,
  상수는 `CONFIRM_SCORE_CODE`):

  | 코드 | 스크립트가 본 것 | reason | 부수효과 |
  |---|---|---|---|
  | 0 | 전 가드 통과 | — | 카테고리·메타 3필드·시그니처·방 누적 총점 기록 + TTL 정렬 |
  | 1 | `game:{id}`에 `roomCode` 필드 없음 | `GAME_NOT_FOUND` | 없음 |
  | 2 | `game:{id}.roomCode` ≠ 인자 roomCode | `GAME_NOT_FOUND` | 없음 |
  | 3 | `room:{code}:players`에 playerId 없음 | `PLAYER_NOT_IN_GAME` | 없음 |
  | 4 | 같은 라운드에 **다른** 시그니처가 이미 있음 | `ROUND_ALREADY_SCORED` | 없음 |
  | 5 | 같은 라운드에 **같은** 시그니처가 이미 있음 | (성공 취급) | 없음 — 멱등 재시도 |
  | 6 | 점수판에 그 카테고리 필드가 이미 있음 | `CATEGORY_ALREADY_USED` | 없음 |
  | 7 | `room:{code}` 키 없음 | `GAME_NOT_FOUND` | 없음 |
  | 8 | `room:{code}.gameId` ≠ 인자 gameId | `GAME_NOT_FOUND` | 없음 |
  | 9 | `room:{code}.phase` ≠ `PLAYING` | `GAME_NOT_ACTIVE` | 없음 |

  - 1·2·7·8이 **game↔room 양방향 매핑 검증**이다. 이게 "오래된 gameId로 현재 방
    점수를 바꾸는" 경로를 막는다. 실패는 전부 `GAME_NOT_FOUND` 하나로 뭉개진다 —
    호출자가 네 경우를 구분하지 않는 것이 계약이라 그대로 뒀다.
  - 4·5는 **라운드 단위 멱등**, 6은 **게임 단위 중복 방지**로 층이 다르다.
  - 그 밖의 값(스크립트가 바뀌었거나 등록이 어긋난 경우)은 `STORE_FAILURE`로
    던진다. 모르는 코드를 성공으로 넘기지 않는다.
  - `runLuaNumber`가 숫자가 아닌 반환을 던지므로 "반환 코드가 계약"이 타입 수준에서도
    지켜진다.
- **`ScoreCategory` enum의 상수 이름은 옮기지 않았다.** Java는 `ACES`(상수) /
  `ones`(apiKey) 두 이름 체계를 들지만, 와이어·Redis 해시 필드·조회 REST 응답 키가
  전부 apiKey다. 상수 이름은 어디에도 노출되지 않으므로 TS에서는
  `'ones' | … | 'yacht'` 유니온 자체를 식별자로 썼다. `ordinal()` 기반 상단 판정도
  별도 목록(`UPPER_CATEGORIES`)으로 바꿨다 — 순서 의존을 하나 없앤 셈.
- **라운드(2.5)와 점수(2.6)는 서로의 구체 타입을 import하지 않는다.** 양쪽이 각자
  좁은 포트를 선언하고 구조적 타이핑으로 만난다:
  `round/roundPorts.ts`의 `ScoreRoundSubmissionPort<R>`·`OpenCategoriesPort` ↔
  `score/scoreRoundSubmissionService.ts`의 `RoundSubmitPort<R>`·`CurrentGameLookup`.
  실제로 `RoundSynchronizationService`(2.5)가 `RoundSubmitPort`를,
  `ScoreRoundSubmissionService`(2.6)가 `ScoreRoundSubmissionPort`를,
  `ScoreConfirmationService`가 `OpenCategoriesPort`를 **어댑터 없이** 만족한다.
  `score/__tests__/scorePorts.contract.test.ts`가 그 대입 가능성을 컴파일 시점에
  고정한다 — 어느 한쪽이 시그니처를 바꾸면 런타임 배선이 아니라 이 파일이 먼저 깨진다.
- **카테고리 목록 중복은 그대로 뒀다(2.2~2.4의 결정 유지).** `RoundSubmission`이
  `SUBMITTABLE_CATEGORIES` 12개를 따로 들고 있는 것은 라운드 → 점수 의존을 만들지
  않으려는 Java의 경계다. 대신 두 목록이 **순서·철자까지 같은지** 검사하는 테스트를
  점수 쪽에 뒀다(`scoreCategory.test.ts`). 갈라지면 "제출은 되는데 채점할 수 없는"
  카테고리가 생긴다.
- **`null` vs `0`을 `Record<ScoreCategory, number | null>`로 표현했다.**
  `undefined`를 쓰면 `JSON.stringify`에서 키가 사라져 12키 계약(2.9의 조회 응답)이
  깨진다. `createScoreBoard`가 12키를 선언 순서로 채우고 `Object.freeze`한다 —
  Java의 `Collections.unmodifiableMap` 자리(프로즌 객체 대입은 strict 모드에서 throw).
- **재현하기로 한 Java quirk**
  - 요청 시그니처 `category:d1,…,d5`가 **주사위 순서에 민감**하다. 재정렬된 재시도는
    멱등(5)이 아니라 `ROUND_ALREADY_SCORED`(4)로 거부된다. 회귀 테스트를 하나 추가했다.
  - `fullHouse`는 5개 동일로 불충족(정확히 2+3), `fourOfAKind`는 야추로도 충족.
  - `calculateUpperSubtotal`에서 **키가 없으면 0, 값이 null이면 예외**. 손상된 값을
    조용히 0으로 세지 않는다는 Java의 선택 그대로.
  - 스크립트 앞의 `HGET game:{id} roomCode`(KEYS 조립용 사전 조회)는 스테일일 수
    있지만 스크립트 안의 양방향 매핑 검증(가드 2·8)이 잡는다 — Java와 같은 구조.
- **고치지 않은 것**: 반환 코드 4와 6의 순서(라운드 충돌이 카테고리 충돌보다 먼저
  걸린다). 같은 라운드에 이미 쓴 카테고리를 다시 보내면 `CATEGORY_ALREADY_USED`가
  아니라 `ROUND_ALREADY_SCORED`가 나온다. 계약이라 그대로 뒀다.
- **동시성 테스트의 성격 차이**: Java는 16스레드 + CountDownLatch, 우리는 한 커넥션에
  `Promise.all` 16건. 노드가 단일 스레드라 "동시 실행"의 모양은 다르지만, 검증 대상은
  같다 — 16번의 EVAL이 Redis에서 직렬 실행될 때 첫 건만 0, 나머지는 5(멱등)를 받아
  점수가 한 번만 반영되는가. 실제로 `hlen(score-submissions) == 1`, 방 누적 총점 15로
  고정된다.
- **`room/keys.ts`를 import해 키를 조립한다**(복사하지 않았다). 키 스킴은 운영 Redis에
  이미 그 이름으로 데이터가 있는 계약이라, 두 벌을 두면 갈라졌을 때 조용히 다른 키를
  쓰게 된다.
- **이식하지 않기로 한 것**
  - Java `ScoreConfirmationCommand`/`ScoreConfirmationResult` record → TS는 평범한
    interface다. 방어적 복사(`List.copyOf`)는 넘기지 않았다 — 확정 경로에서 dice를
    붙잡아 두는 곳이 없고(시그니처 문자열로 즉시 소비), `readonly number[]`가
    호출부 실수를 컴파일에서 잡는다. 대신 **점수판은 실제로 얼린다**(2.9의 응답이
    이 객체를 그대로 싣는다).
  - `ScoreBoardStore`의 동기 시그니처 → 전부 async. Redis 호출이 뒤에 있고
    `beforeStateChange`가 이미 async 계약이다(2.4의 결정).
- 남은 자리: `GAME_NOT_ACTIVE`·`PLAYER_NOT_IN_GAME` 등 이유 코드 → WS 오류 코드
  매핑은 **3.1(야추 모듈)**의 몫이다. 2.6은 이유 코드까지만 만든다.
- 2.7·2.9가 쓸 것: `scoreBoardFromHash`(같은 해시를 읽는 조회 스토어와 공유),
  `_` 접두 메타 필드 상수(`UPPER_SUBTOTAL_FIELD`·`UPPER_BONUS_FIELD`·`TOTAL_FIELD`),
  `SCORE_CATEGORIES`(12키 직렬화 순서), `calculateScore`(2.9의 무인증 후보 계산기 —
  후보는 불충족을 null이 아니라 0으로 내보낸다는 점만 그쪽에서 처리하면 된다).

# notes — Phase 4.2 (소셜 로그인)

## 2026-08-14 - Phase 4.2 (소셜 로그인)

- **환경변수 이름은 문서가 아니라 `application.yaml`에서 확인했다.** `yorr.auth.*`가
  실제로 읽는 이름은 `AUTH_FRONTEND_REDIRECT_URI` · `KAKAO_CLIENT_ID` ·
  `KAKAO_CLIENT_SECRET` · `KAKAO_REDIRECT_URI` · `GOOGLE_CLIENT_ID` ·
  `GOOGLE_CLIENT_SECRET` · `GOOGLE_REDIRECT_URI`이고 기본값까지 그대로 옮겼다
  (`backend-java/.env.example`과도 일치). operations.md 표와 어긋나는 것은 없었다.
- **`DB_URL` 정렬: 파싱해서 기존 분해 변수를 덮어쓰는 쪽으로 갔다.** Java는
  `url: ${DB_URL}` 하나(JDBC URL)만 읽는데 `config/env.ts`는 `DB_HOST`/`DB_PORT`/
  `DB_NAME`으로 쪼개져 있었다. 셋을 지우면 `infra/mysql.ts`(4.1 소유)를 고쳐야 하고,
  DB_URL을 무시하면 운영 `.env`가 조용히 localhost로 붙는다. 그래서 zod
  `.transform()`에서 **DB_URL이 있으면 파싱해 세 값을 덮어쓴다** — `infra/mysql.ts`는
  한 줄도 바뀌지 않고 운영 `.env`가 그대로 먹는다. 우선순위는 DB_URL > 분해 변수
  (운영 파일에 적힌 쪽이 이긴다). 읽을 수 없는 DB_URL은 기본값으로 흘리지 않고
  **기동을 막는다** — 엉뚱한 DB에 조용히 붙는 것이 가장 나쁘다.
- **JDBC URL의 쿼리 파라미터는 일부러 버린다.** 운영 값에
  `serverTimezone=Asia/Seoul`이 들어 있는데, 그걸 mysql2로 옮기면 4.1이
  `timezone: 'Z'`로 막아 둔 9시간 어긋남이 그대로 되살아난다(persistence.md의
  `finished_at` 계약). `useSSL`·`characterEncoding`도 mysql2에서는 이름이 달라
  옮기지 않았다. userinfo(`user:pass@`)도 무시한다 — JDBC에서도 프로퍼티가 URL을
  이기므로 Java와 같은 결론이다.
- **Java `URLEncoder`와 `encodeURIComponent`는 다르다.** 공백(`+` vs `%20`)과
  `!'()~`가 갈린다. `GoogleOAuthClientTest`가 `scope=openid+profile+email`을
  문자열로 고정하고 있어 그대로면 테스트가 깨지고, 무엇보다 인코딩 모양이 계약이라
  `formUrlEncode`를 따로 만들었다(`auth/oauthHttp.ts`).
- **타임아웃은 Java와 값이 다르다(의도적).** Java는 connect 3s + read 5s인데
  Node `fetch`에는 그 구분이 없다. 최악값인 **8초를 통짜 예산**으로 잡았다. 더
  짧게 잡으면 Java에서 성공하던 느린 로그인이 여기서만 실패한다. 참고로 Java가
  단 이유(톰캣 스레드 고갈)는 Node에 그대로 적용되지 않지만, 안 걸면 로그인 요청이
  영영 매달리므로 예산 자체는 필요하다.
- **제공자 오류 본문은 읽지도 않는다.** 응답 본문을 파싱해 오류에 담으면 언젠가
  응답으로 새 나갈 위험이 생긴다 — 상태 코드만 담고 `provider_error`로 뭉갠다.
  테스트로 "본문의 비밀 문자열이 오류 체인에 없다"를 고정했다.
- **경합 재조회를 이식하려면 오류 갈래가 필요했다.** Java는
  `DataIntegrityViolationException`(유니크뿐 아니라 길이·FK 위반 포함)을 잡는데,
  `SocialLoginServiceTest`의 마지막 케이스가 "nickname too long"으로 **같은 갈래인데
  경합이 아닌** 경우를 고정한다. 그래서 mysql2 errno(1062·1406·1452 …)를 저장소에서
  `DataIntegrityViolationError`로 승격하고, 서비스는 그 타입만 보고 재조회한다.
  덕분에 서비스 테스트가 MySQL 없이 돈다.
- **트랜잭션 경계 분리는 Node에서 "다른 커넥션의 트랜잭션"이 된다.** Java가
  registrar를 별도 빈으로 뺀 이유(프록시 경계)는 Node에 없지만, 재조회가 의미를
  가지려면 **가입 트랜잭션이 먼저 끝나 있어야** 한다는 사실은 같다. 그래서 등록·
  채택은 `pool.getConnection()` → `beginTransaction/commit`으로 자기 트랜잭션을
  열고 닫는다(조회는 풀에서 바로).
- **`adoptProviderProfile`은 트랜잭션 안에서 플레이스홀더인지 다시 본다.**
  서비스가 이미 판정했지만 그 사이 사용자가 직접 개명했을 수 있다(4.3의 PATCH).
  `SELECT ... FOR UPDATE` 후 재확인한다 — Java의 `@Transactional` + dirty checking과
  같은 효과를 명시적으로 쓴 것.
- **quirk 그대로 이식: authorize는 설정 확인 전에 state를 발급한다.** Java의 인자
  평가 순서(`authorizeUrl(stateStore.issue(), ...)`)가 그렇다. 미설정 제공자를 부르면
  쓰이지 않는 state 키가 하나 남지만 5분 TTL이라 사라진다. 응답(503)은 동일하므로
  "조용히 개선"하지 않고 그대로 뒀다.
- ⚠️ **MySQL이 이 환경에 없다(4.1의 관찰과 동일 — `mysqld`·`mysql` 바이너리 없음,
  docker 소켓 없음).** `auth/__tests__/socialAccountStore.test.ts`의 6건은
  `MYSQL_TEST_URL`이 없어 **skip**됐고 한 번도 실행되지 않았다. `MYSQL_TEST_URL`이
  있는 환경에서 첫 실행이 필요하다. 나머지 56건(순수 로직·Redis·REST)은 실행돼
  통과했다.
- **회원 세션 발급은 `user/session.ts`의 `openMemberSession`을 그대로 썼다**(읽기
  전용 계약). 재로그인이 tokenHash를 덮어써 이전 토큰이 죽는 것을 REST 테스트로
  확인했다 — auth.md의 "계정당 라이브 세션 1개"가 실제로 성립한다.
- **`server.ts` 배선은 하지 않았다**(오케스트레이터 소유). auth 라우트 등록 +
  MySQL 풀 + `verifyMigrations` 호출 위치는 보고에 코드 조각으로 적었다.
  persistence.md가 "`verifyMigrations`는 서버 기동(4.2에서 배선)"이라고 적어 둔
  항목이 아직 열려 있다.

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
