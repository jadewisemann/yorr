# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·제약·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식으로 판정된 항목은 DESIGN.md(또는 docs/design·ADR)로
> 승격하고 여기서 지운다. 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.
>
> ⚠️ **승격 부채**: 마이그레이션이 티켓 20개를 한꺼번에 지나오면서 이 파일이
> 1,300줄을 넘었다. 각 티켓의 설계 문서(`docs/design/*.md`)는 그때그때 갱신됐지만,
> 여기 남은 항목 중 **영구 지식으로 승격하고 지워야 할 것**을 걸러내는 작업은
> 아직 하지 않았다. Phase 5의 문서 정리에 포함한다 — 그때까지 이 파일은
> "휘발성 메모"가 아니라 사실상 티켓별 결정 기록이다.

## 2026-08-14 - Phase 3.4 (탁구)

### Java와 다르게 결정한 것

- **협력자 7개를 전부 좁은 포트로 뒤집었다**(`pingPongPorts.ts`). Java
  `PingPongGameService`는 `RedisPingPongStateStore`·`RoundDeadlineScheduler`·
  `RoomBroadcaster`·`RealtimeRoomSnapshotService`·`RoomSessionRegistry`·
  `GameCompletionService`·`StringRedisTemplate`·`RoomValidationService`를 구체
  타입으로 잡는다. 2.5·2.7과 같은 이유(병렬 작업 중인 ws·room·completion에 컴파일
  의존을 만들지 않고, "도메인은 전송 계층을 모른다"를 지킨다). 실제 구현이 어댑터
  없이 구조적으로 만족하고 `pingPongPorts.contract.test.ts`가 그 대입을 고정한다.
- **`StringRedisTemplate` 직접 사용을 `PingPongScoreWriter` 포트 + 어댑터로 뺐다.**
  Java는 `changed()` 안에서 `hasKey(players) → put(scores)`를 직접 한다. 그 로직
  자체는 그대로 옮겼고(roster 필터가 몰수자의 유령 점수를 막는 핵심이다) 서비스가
  Redis 클라이언트를 들고 있지 않게만 바꿨다.
- **방 스냅샷 타입을 제네릭으로 받았다**(`PingPongGameService<S extends object>`).
  Java는 `RoomSnapshot` 레코드를 재조립(`new RoomSnapshot(..., state, ...)`)하지만
  우리 `WsRoomSnapshot`은 인터페이스라 `{...room, game: state}` 스프레드로 충분하고,
  덕분에 서비스가 ws 타입을 import하지 않는다. 모듈이 `S = WsRoomSnapshot`으로
  고정한다(2.8 `PhasedRoomSnapshot`과 같은 경계).
- **시계·좌우 RNG를 주입 시임으로 만들었다**(`now`·`randomTarget`). Java는
  `System.currentTimeMillis()`·`ThreadLocalRandom`을 직접 부른다. 판정 시각이
  이 게임의 계약(120ms 되감기)이라 시임 없이는 실시간 sleep 테스트가 된다.
- **`point()`의 `forcedType` 인자를 지웠다.** Java에 있지만 호출자가 하나뿐이고
  항상 `null`을 넘긴다(죽은 매개변수). 동작 변화 없음.
- **`swing`의 판정 사다리를 두 헬퍼로 쪼갰다**(`recordOnly`·`missedWindow`·
  `returnKind`). biome `noExcessiveCognitiveComplexity` 때문이고 분기 순서·조건은
  그대로다. 가드 순서 자체가 계약이라 순서를 바꾸지 않았다.

### 재현하기로 한 quirk

- **`judgedAt`의 공짜 되감기 구멍**: 클라 시계가 서버보다 뒤져 있으면 최대 120ms를
  공짜로 얻는다. Java 주석이 개선안(`clientTs` 대신 "상태 수신 후 경과 ms")까지
  적어 뒀지만 **와이어 계약 동결**이라 그대로 이식했다. 고치려면 프론트의
  `PingPongSwingPayload`가 바뀌므로 별도 결정이 필요하다.
- **모듈 오류 매핑의 비대칭**: `IllegalArgumentException`(=`DomainError`)만 자기
  코드를 싣고, 그 밖은 전부 `invalid swing payload`로 뭉개진다. 스토어의
  `game_state_busy`(`IllegalStateException`)도 여기로 온다 — 락 경합이 "payload가
  잘못됐다"로 보고되는 것이 Java의 실제 동작이다. 조용히 개선하지 않았다.
- **payload 관용**: `{}`는 `{inputSeq:0, clientTs:0}`이 된다(Jackson record 바인딩의
  primitive 기본값). zod 스키마를 `nullish()`로 열어 같은 결과를 만들었다.
- **`rally`는 득점해도 리셋되지 않는다**(`serve`에서만 0으로 돌아간다). Java
  `point()`가 `state.rally()`를 그대로 넘긴다 — COUNTDOWN 구간에 직전 랠리 수가
  남아 있는 것이 화면 연출용이라고 보고 그대로 뒀다.
- **`faultFrom`은 폴트가 없어도 채워진다**(`progress(pos, 새 direction)`). 이름과
  달리 "리턴 시점의 진행률"이라 폴트 없는 공에도 값이 있다.

### 발견 / 함정

- ⚠️ **인라인(즉시 실행) `DeadlineExecutor`로는 탁구 테스트를 쓸 수 없다.** 서브 →
  실점 → 카운트다운 → 서브가 무한히 이어지므로 지연을 무시하는 executor는 그대로
  무한 루프가 된다(실제로 vitest가 120초 타임아웃까지 돌았다). 2.3의 회귀 테스트가
  쓰는 인라인 executor는 "슬롯 선등록" 검증용 1회성 패턴이고, 게임 진행 테스트는
  **작업을 모아 두고 테스트가 직접 발화시키는 executor**를 써야 한다.
- 스케줄러의 `roundNumber` 자리에 상태 `version`을 넣는다. `version`이 1부터
  시작하므로 `InMemoryRoundDeadlineScheduler`의 `roundNumber >= 1` 검증을 그대로
  통과한다 — duel도 같은 전제일 것이다(3.3과 맞춰 볼 것).
- `RedisPingPongStateStore`의 TTL 복사는 방 키에 PTTL이 **있을 때만** 한다. 테스트가
  `hset`으로 방을 직접 심으면 TTL이 없어 게임 상태도 무기한이 된다(운영에서는
  CREATE Lua가 항상 TTL을 붙이므로 문제 없음).
- 종료 경로에서 **점수 기록이 `finishIfComplete`보다 먼저**여야 한다. 순서를 바꾸면
  `game.over`의 순위가 이전 점수(0)를 읽는다. Java도 같은 순서.
- 부동소수 상수(`1 - 1.06 = -0.06000000000000005` 등)는 Java double과 JS number가
  같은 IEEE754라 값이 일치한다 — 미러 창을 상수로 다시 적지 않고 계산식을 그대로
  옮긴 이유다.
- `game/duel/`에는 아직 `duelState.ts`만 있다(3.3 진행 중). duel과 공유할 수 있는
  것(방 락 스토어 패턴·version 스케줄링)이 보이지만 **지금 공통화하지 않았다** —
  두 슬라이스가 병렬이라 그 추출은 두 게임이 다 들어온 뒤의 별도 작업이다.

### 오케스트레이터 조치 필요

- `server.ts` 배선이 없으면 REST로 시작한 탁구 방의 모듈 훅이 하나도 돌지 않는다
  (빌드·테스트는 통과한다). 아래 조각을 넣어야 한다 — **브로드캐스터·레지스트리·
  스냅샷·스케줄러는 반드시 기존 인스턴스를 재사용**할 것.
- 2.7 `GameCompletionService`가 배선되기 전까지 `completion`은 `server.ts`의
  경고 스텁(`gameCompletion`)을 그대로 넘기면 된다 — 탁구는 `force=true`만 쓰므로
  스텁이 false를 돌려주면 `game.over`가 나가지 않는다는 점만 알아 두면 된다.
- `docs/design/game-modules.md` 맨 아래 「불변식」의 "게임 추가 시 손댈 곳"에
  `+ 카탈로그 행`이 여전히 빠져 있다(2.1이 남긴 항목, 공유 절이라 손대지 않았다).

## 2026-08-14 - Phase 3.1 (야추 모듈)

- **1.5·2.1이 남긴 registry phase 구멍을 닫았다.** `YachtDiceGameModule.start`가
  `registry.markPhase(roomCode, 'playing')`을 부른다(Java와 같은 자리). 이 한 줄이
  없으면 REST로 시작한 게임에 **이미 붙어 있는** 소켓들의 레지스트리 phase가
  `waiting`에 머물러 ① 끊긴 플레이어가 offline이 아니라 `room.player_left`가 되고
  ② `GameSocketHandler`의 재접속 PLAYING 분기(스냅샷에 `game` 동봉)가 실전에서
  **도달하지 않는다**. `reset`은 반대로 `'waiting'`으로 되돌린다. `close`는 phase를
  건드리지 않는다(방 자체가 사라진다 — Java와 같음).
  - 부수 결론: **세 게임 모듈이 다 등록되면 핸들러의 `moduleless` 대역은 도달
    불가가 된다**(2.1의 메모). 야추가 첫 번째다.
- **바깥 계층 7개를 좁은 포트로 뒤집었다**(`yacht/yachtPorts.ts`):
  `YachtBroadcaster`·`YachtSeatRegistry`·`YachtRealtimeSnapshots`·
  `YachtReconnectSnapshots`·`YachtRoundService`·`YachtRoundTimer`·`YachtScoreSubmission`.
  2.5·2.8과 같은 이유에 하나가 더 있다: **`RoundTimerService`·`RoundSynchronizationService`가
  private 필드를 가진 클래스라 TS에서 명목 타입**이어서, 포트가 없으면 Java 테스트의
  `mock(RoundTimerService)` 자리에 구조적 스텁을 넣을 수 없다.
  - 반대로 **라운드 도메인 타입(`RoundState`·`RoundSubmitPayload`·`TurnAdvanceInput` …)은
    그대로 import**했다. 그쪽은 "바깥 계층"이 아니라 이 모듈이 올라선 프레임워크이고,
    모양을 다시 선언하면 상태·와이어 계약이 갈라진다(2.5가 `gameWsType` 사본을 지운
    것과 같은 판단).
  - `__tests__/yachtPorts.contract.test.ts`가 대입 가능성을 고정한다. Redis·타이머
    의존으로 인스턴스를 만들 수 없는 것은 타입 수준(`extends`)으로만 확인한다.
  - `handle(socket: ClientSocket, …)`은 `GameModule` 시그니처가 강제하므로 모듈
    파일에서는 `ws/socket.js`·`ws/protocol.js`를 **타입으로** import한다(포트 파일은
    ws를 모른다). `isOpen`만 값으로 가져왔다 — `SOCKET_OPEN = 1`을 복사하면 그 상수가
    두 곳으로 갈라진다.
- **payload 검증을 의도적으로 관용적으로 만들었다.** Java `objectMapper.treeToValue`는
  타입이 어긋나면 실패하고(→ `INVALID_MESSAGE`) **없는 필드는 record 기본값**(int 0,
  참조 null)이 된다. zod로 엄격하게 막으면 같은 `INVALID_MESSAGE`라도 **턴 소유
  검증보다 앞서게** 되어 "남의 턴에 보낸 held 없는 dice.roll"의 응답이 Java와 달라진다
  (Java는 `RoundState.recordRoll`의 `NOT_ACTIVE_PLAYER`가 먼저 걸린다). 그래서
  스키마는 전부 `nullish()`이고 `payloads.ts`의 `to*` 변환이 빈 자리를 0·`[]`·`''`로
  메워 **도메인이 이유 코드와 함께 판정**하게 한다.
  - 검사 순서도 Java 그대로: `roomId` 검증 → payload 파싱 → (shake/throw만) 활성 판정.
    남의 턴에 깨진 `dice.shake`를 보내면 무음이 아니라 `INVALID_MESSAGE`가 나간다.
- **`game_state_busy`에 응답을 만들지 않기로 했다(quirk 재현).** 방 락 대기 2초를
  넘기면 `ConflictError('game_state_busy')`가 모듈의 `sendDomainError`에 걸리지 않고
  그대로 올라간다 → 게이트웨이가 로그만 남기고 소켓을 살려 둔다. Java도 그
  `IllegalStateException`을 잡지 않아 Spring 밖으로 나가고 **응답이 아예 없다**.
  `INTERNAL`을 새로 내보내는 쪽이 프론트에 친절하지만, 그건 Java가 침묵하는 경우에
  **새 오류 응답을 추가하는 것**이라 계약을 넓힌다(2.1의 `INVALID_MESSAGE` 재사용과
  성격이 다르다). 문서에 명시했다.
- **락 해제의 `finally`가 두 가지 역할을 한다.** ① TTL이 먼저 만료돼 남이 락을 새로
  잡은 상황에서 남의 락을 풀지 않는다(토큰 비교) ② **락을 못 잡고 나가는 경로에서도
  안전하게 no-op**이 된다(Java의 `finally`도 무조건 UNLOCK을 부른다). 해제 실패는
  삼킨다 — 여기서 던지면 이미 성공한 전이의 결과를 잃는다. 테스트로 둘 다 고정했다.
- **동시성 테스트의 성립 근거가 락만이 아니다.** "동시 동일 굴림 2건 중 1건만 성공"은
  락으로 **직렬화된 뒤** 두 번째가 `rollCount` 연속성(1 → 2)에 걸려 거부되는 조합이다.
  락이 없으면 둘 다 `activeRollCount 0`을 읽어 **둘 다 성공**한다(그게 이 테스트가
  잡는 회귀다). Java는 2스레드 `invokeAll`, 우리는 한 커넥션에 `Promise.all` 2건 —
  2.6의 16건 테스트와 같은 성격 차이다.
- **`initialize`는 락을 잡지 않는다**(Java와 같음). `SET NX` 자체가 원자적이라
  락은 불필요하고, 락을 잡으면 "시작 직후 첫 굴림"이 불필요하게 한 번 더 대기한다.
- **TTL 복사의 관측된 성질**: 방 키에 TTL이 없으면 `copyRoomTtl`이 아무것도 하지
  않아 상태 키가 **무기한**으로 남는다(pttl −1). Java와 같고, 회수는 스위퍼(2.8)의
  몫이다 — 테스트로 고정했다. 방 키가 이미 사라진 경우도 같다.
- **`roomIds()`는 야추 상태 키만 SCAN한다**(`room:*:game:YACHT_DICE:state`).
  스위퍼가 이 목록을 쓰므로 패턴이 넓어지면 duel·pingpong 상태를 걷어간다.
  ioredis에 `Cursor`가 없어 커서 루프를 직접 돌렸다(COUNT 100은 Java와 같음).
- **스냅샷 JSON의 필드 이름·순서를 Java record 그대로 유지했다.** 전환기에는 Node와
  backend-java가 같은 키(`room:{code}:game:YACHT_DICE:state`)를 읽을 수 있어야 하므로
  여기서 이름을 다듬으면 진행 중인 게임이 깨진다. `submissions`는 Jackson이 record를
  펼친 모양이고, 우리 `RoundSubmission` 클래스의 readonly 필드가 `JSON.stringify`에서
  같은 객체를 만든다(역직렬화는 생성자를 다시 통과 = 검증도 다시 돈다).
  - 읽기에는 zod를 썼다. Java는 Jackson 실패가 `invalid_yacht_state`로 뭉개지는데
    우리도 같은 코드로 뭉개되, `CodedError`가 코드 문자열만 받으므로 **원인은 표준
    `Error.cause`에 붙였다** — 손상된 스냅샷을 진단할 때 그것만이 단서다.
  - 관용 하나: `submissions`·`activeDice`·`activeHeld`가 없으면 각각 `{}`·null로 읽는다
    (Jackson도 없는 필드를 null로 둔다 — 옛 스냅샷 호환).
- **`YachtDiceState`(재접속 와이어)를 재선언하지 않고 재수출했다.** 2.8이
  `game/reconnect/yachtDiceState.ts`에 두면서 "필요하면 `game/yacht/`에서 재수출"이라고
  적어 뒀다. 만드는 곳이 재접속 스냅샷 하나뿐이라 소유자는 그쪽이 맞다.
- **Java 테스트 배치와 달라진 곳**: `GameWebSocketHandlerTest`의 dice·submit 케이스가
  Node에서는 **모듈 테스트**가 된다(2.1의 결정으로 오류 응답을 모듈이 만든다).
  게이트웨이·핸들러 경로는 1.5 스위트가 이미 덮으므로 중복해서 옮기지 않았다.
  대신 `GameModuleRegistry.dispatch`를 통과하는 케이스를 하나 넣어 접두사 스트립·교차
  네임스페이스 거부가 야추와 실제로 맞물리는지 확인한다.
- **브로드캐스터·레지스트리를 테스트에서 진짜로 썼다.** Java 테스트가 확인하는 것의
  절반이 "같은 프레임이 방 전원에게 **한 번 직렬화되어** 나가는가"와 정확한 JSON
  문자열(`"auto":false`·`"held":[false,…]`)이라, 대역으로 바꾸면 그 계약이 테스트에서
  사라진다(1.6에서 같은 판단).
- **`ScoreConfirmationService`도 진짜를 쓴다**(저장소만 대역). Java는 서비스를 모킹해
  "카테고리 파싱 → 서버 재계산 → 시그니처"가 이 경로에서 실제로 도는지 확인하지
  않는다. 모킹하면 테스트가 그 순서를 스스로 정의해 버린다.
- **메시지 문구는 우리 관용(한글)을 따랐다.** 모듈이 스스로 만드는 문구
  (payload 오류·NOT_IN_ROOM·NOT_YOUR_TURN)는 `ws/handler.ts`와 같이 한글로 썼고,
  도메인 오류는 Java처럼 `error.message`를 그대로 통과시킨다(그쪽은 2.2~2.6이 이미
  이식한 문구다). 프론트는 `code`로만 분기하므로 계약 차이는 없다.
- **미해결 — `server.ts` 배선이 아직 안 됐다**(오케스트레이터 소유). 세 가지가 함께
  필요하다: ① `InMemoryRoundStateStore` → `RedisYachtDiceStateStore` 교체
  ② 2.7 `GameCompletionService`·2.8 `GameReconnectSnapshotService`·2.9
  `GameScoreQueryService` 실제 배선(현재 `gameCompletion`은 항상 false를 돌려주는
  경고 스텁이다) ③ `games.register(new YachtDiceGameModule(...))`.
  배선 조각은 임시 파일 + `tsc --noEmit`으로 **실측 검증했다**(커밋하지 않았다).
- **미해결 — 프론트 실물 검증(`e2e:real`)은 못 했다.** 배선이 안 됐으므로 이 슬라이스는
  아직 프론트로 확인되지 않았다. Phase 3.1의 완료 기준(프론트 E2E)은 배선 패스 뒤에
  닫힌다. 봇 포함 완주는 3.2 이후.
- **`OrphanedRoundStateSweeper`가 이제 진짜로 쓸모가 있다.** 인메모리 스토어에서는
  프로세스 재시작에 상태가 함께 사라져 고아가 생기지 않았지만, Redis 스토어부터는
  방 키 TTL이 없는 상태 키가 남을 수 있다. 배선에 포함해야 한다.

## 2026-08-14 - Phase 3.3 (듀얼)

- **`DuelRules`를 클래스가 아니라 모듈 함수로 옮겼다.** Java는 `private` 생성자를 둔
  static utility class인데, TS에서는 그 껍데기가 순수성을 보장해 주지 않는다. 이름은
  Java와 1:1(`signal`·`draw`·`expire`·`nextRound`·`finish`·`forfeit`·`compareDraw`·
  `hold`)로 두고 `initial`만 `initialDuelState`로 바꿨다 — 배럴(`index.ts`)에서
  다른 게임의 `initial`과 부딪히지 않게.
- **스토어의 version 가드를 Java보다 좁혔다(`==` → `<=`).** Java `mutate`는
  `next.version() == current.version()`만 걸러 버전이 *내려가는* 갱신은 그대로 쓴다.
  결투는 두 플레이어의 draw와 서버 타임아웃이 같은 ms에 도착할 수 있고, 타임아웃
  콜백이 옛 스냅샷을 들고 있는 경로가 실제로 존재해서(예약 시점의 `state`) 그 창을
  구조적으로 닫았다. PLANS.md 3.3의 완료 기준("version 비증가 무시")도 이쪽 문구다.
  회귀 테스트: `redisDuelStateStore.test.ts`의 "version이 내려간 갱신도 무시된다".
- **점수 기록을 `DuelScoreboardPort`로 뺐다.** Java `DuelGameService.changed`는
  `StringRedisTemplate`을 직접 들고 roster 확인 + 점수 해시 쓰기를 인라인으로 한다.
  그대로 옮기면 진행 서비스가 Redis에 묶여 단위 테스트가 못 돈다(그리고 game-modules.md의
  전송/도메인 분리를 깬다). 어댑터는 `RedisDuelScoreboard` 하나뿐이고 Lua는 쓰지 않았다 —
  결투의 점수는 판정이 끝난 잔탄 하나라 원자적 검증이 필요 없다.
- **점수 = 잔탄, 쓰러진 쪽은 0.** `lastRound.koId`가 곧 "쓰러진 쪽"이라
  `SELF_SHOT`(hp 2 잔존)·`FORFEIT`(hp 0)·`SHOT`(hp 0) 세 종료 경로가 같은 규칙으로
  덮인다. roster에 없는 playerId는 건너뛴다(떠난 참가자 부활 금지) — Java와 같다.
- **`markPhase('playing')`은 `start`에서 부른다**(3.1과 같은 계약). 2.1 노트의
  「registry phase 구멍」이 duel 쪽에서는 이걸로 닫힌다. `reset`은 대칭으로
  `markPhase('waiting')`. 포트를 `'playing' | 'waiting'` 리터럴로 좁혀 두면
  `RoomSessionRegistry.markPhase(WsRoomPhase)`가 그대로 대입된다.
- **스케줄러의 두 번째 인자에 `state.version`을 넣는다** — `InMemoryRoundDeadlineScheduler`의
  파라미터 이름은 `roundNumber`지만 그 값에 요구되는 성질은 "≥1이고 방 하나당 하나,
  재예약 시 앞의 것 무효"뿐이라 버전 키로도 규약이 유지된다(`cancel(roomId, n)`은
  결투가 쓰지 않는다 — 취소는 항상 `cancelRoom`). 포트 주석에 그 근거를 적어 뒀다.
- **`draw` payload 검증을 zod로 모듈 경계에 뒀다.** Java는 Jackson `treeToValue`
  실패를 catch해 "invalid draw payload"로 뭉갠다. 정수가 아닌 값(`1.5`·`"one"`)도
  같은 응답으로 떨어지게 `z.number().int()`를 쓴다. 도메인 거부(`invalid_duel_draw`)만
  코드 문자열이 그대로 나가고 나머지는 뭉갠다 — Java의 catch 순서와 같은 결과.
- **`lastRound` 안의 null은 진짜 `null`, `lastRound` 자체는 생략.** Java의
  `@JsonInclude(NON_NULL)`이 `DuelState`에만 붙어 있고 중첩 `Round` 레코드에는 없어서
  실제 프레임이 그렇게 나간다. 프론트 타입은 `?: T | null`로 둘 다 받지만 바이트를
  맞춰 뒀다(계약 동결). 테스트가 `toEqual`을 쓰므로 `undefined` 키는 무시된다.
- 발견: **`GameStartResult.snapshot`은 REST 스냅샷(`RoomSnapshot`)이라 `kind`가
  대문자 `'HUMAN'`/`'BOT'`이다.** WS 스냅샷과 모양이 달라(phase 대소문자·score 유무)
  봇 필터를 WS 쪽 타입으로 짜면 조용히 빈 명단이 된다. 서비스는 `DuelStartRoster`
  (hostId + {playerId, kind})만 요구하는 좁은 모양으로 받는다.
- 발견: **2.7 `GameCompletionService`는 아직 `server.ts`에 배선되어 있지 않다**
  (스텁 `gameCompletion`이 항상 false + 경고 로그). 듀얼은 종료 방송을 완료 서비스에
  의존하므로(그쪽이 `game.over` + `state.sync`를 쏜다) **스텁이 남아 있으면 결투가
  FINISHED가 되어도 결과 화면으로 넘어가지 않는다.** 오케스트레이터가 3.3 배선과 함께
  실제 서비스를 꽂아야 한다 — 최종 보고에 조각을 적었다.
- 실패한 접근: 서비스를 제네릭 없이 짜려고 `DuelRoomSnapshot`을 구조 타입으로 좁혀
  봤는데, `{...room, game}`이 `WsRoomSnapshot`으로 다시 좁혀지지 않아 모듈의
  `reconnect` 반환 타입이 깨졌다. 2.8 `GameReconnectSnapshotService<S>`와 같은
  제네릭 파라미터로 돌렸다(`DuelGameService<S>`, 배선은 `S = WsRoomSnapshot`).

## 2026-08-14 - Phase 3.5 (퀵매치)

### 계약 확인 (Java에서 직접 읽은 것)

- **퀵매치 REST의 오류 본문은 방 REST와 같은 plain-text 문자열 코드**다
  (`QuickMatchController`가 `ResponseEntity.body(exception.getMessage())`로 코드
  문자열을 그대로 싣는다). 조회 REST(2.9)의 JSON `{code,message}`와 섞지 않았다.
  다만 두 곳이 방 REST와 다르다:
  1. **401 본문이 `unauthorized`** (방·봇은 `invalid_guest_session`). `error.code`가
     아니라 **리터럴**이다 — `SessionAuthenticationError.code`를 그대로 쓰면 계약이 깨진다.
  2. `IllegalArgumentException` 갈래가 **전부 400**이다(방 REST는 기본 404 +
     `invalid_nickname`·`invalid_game_code`만 400). 그래서 공용 `sendDomainError`를
     쓸 수 없고 `sendQuickMatchError`를 라우트 파일에 따로 뒀다.
  3. `SessionAuthenticationError extends DomainError`이므로 **검사 순서가 계약**이다.
     뒤집으면 401이 조용히 400으로 바뀐다(테스트로 고정).
- **GET·DELETE는 401만 잡는다.** Java도 그 둘에서 `IllegalArgumentException`/
  `IllegalStateException`을 잡지 않는다 → 나머지는 500. 재현했다(`sendUnauthorizedOnly`).

### 이미 이식돼 있던 전제

- `UserService.clearRoom`이 **이미** `quick-match:user:{userId}`를 지운다(1.2에서
  이식됨). 티켓 키 이름이 그 코드에 하드코딩돼 있으므로 바꿀 수 없고, Java 테스트
  `leavingRoomClearsThePreviousMatchTicket`이 성립하는 이유도 그 한 줄이다.
- 매칭 인원의 출처는 `game/catalog.ts` 하나뿐이다(Java는 `GameModule`). Java 테스트가
  `GameModuleRegistry`를 모킹해 3인 게임을 넣던 자리는 **카탈로그를 바꿔 끼우는
  것**으로 옮겼다 — 정원의 유일 출처 원칙(2.1)과 같은 결이다.

### Java와 다르게 결정한 것

1. **`SOCKET_OPEN = 1`을 room 도메인에 다시 적었다.** `ws/socket.ts`에 같은 상수가
   있지만 `game/round/roundPorts.ts`가 `RoundBroadcaster`를 직접 선언한 것과 같은
   판단이다(방 도메인 → 전송 계층 의존 금지). 대신 `QuickMatchPresence` 포트에
   "왜 status가 아니라 socket인가"를 못박아 뒀다.
2. **`statusOf`의 스냅샷을 두 번 읽지 않는다.** Java는 PLAYING 판정에서
   `rooms.getSnapshot(roomId)`를 한 번 더 부른다(같은 값). 관측 가능한 차이는 없고
   Redis 왕복만 줄었다.
3. **`cancel`에서 gameCode가 null인 티켓은 zrem을 건너뛴다.** Java는 문자열 연결로
   `quick-match:queue:null` 키를 지우려 한다(무해하지만 무의미). WAITING 티켓에는
   항상 gameCode가 있으므로 도달 불가 경로다.
4. **테스트에서 `games.start`를 모킹하지 않고 기록 래퍼로 감쌌다.** Java는
   `mock(GameLifecycleService)`라 `verify(games).start(roomId)` 뒤의 **phase 전이와
   마커 삭제를 보지 못한다.** 진짜 `GameLifecycleService`에 위임해 그 뒤까지 고정했다.
5. Java `QuickMatchServiceIntegrationTest`가 검증하지 않은 5건을 회귀 방어로 추가:
   CLOSING 소켓은 라이브가 아니다 / 5분 초과 대기자 청소(시각 주입) / 세션 만료자
   퇴출 후 판 무성립 / enter 멱등(큐 한 줄) / `already_in_room` · 
   `quick_match_not_supported`.

### 남은 것 / 넘긴 것

- **`server.ts` 배선은 하지 않았다**(소유 밖). 라우트 등록 코드 조각은 보고에 실었다.
  퀵매치는 WS 게이트웨이와 **같은 `RoomSessionRegistry` 인스턴스**를 받아야 한다 —
  새로 만들면 소켓 조건이 영원히 거짓이 되어 **자동 시작이 조용히 안 된다**(1.6 봇
  브로드캐스터와 같은 함정이며 빌드·타입체크는 통과한다).
- 기존 Lua는 하나도 건드리지 않았다. 새 스크립트는 `yorrQuickMatchUnlock` 하나이고
  `quickMatchService.ts` 안에 있다.
- 알려진 한계(Java 주석 그대로): 매칭+방 생성이 한 Lua가 아니라 그 사이 크래시 시
  방이 고아로 남는다. 5초 락 TTL이 큐를 막지는 않는다. 고치려면 방 생성까지 한
  스크립트로 내려야 하는데 `CREATE`/`JOIN` 수정이 필요해 이번 범위 밖으로 뒀다.

## 2026-08-14 - Phase 4.4 (전적 보관)

- **`MatchArchivePort`(2.7)를 어댑터 없이 만족시켰다.** 포트 시그니처는
  `archive(room: CompletionRoomSnapshot, rankings: readonly Ranking[]): Promise<unknown> | unknown`
  이고, 서비스는 파라미터를 `| null | undefined`로 **넓혀** 받아(Java의 null 가드 이식)
  `Promise<boolean>`을 돌려준다 — 둘 다 대입 가능성을 유지하는 방향이다. 테스트에서
  `const port: MatchArchivePort = service`로 고정했고, 실제로 포트 변수를 통해 호출한다.
  `completion/`의 파일은 한 줄도 건드리지 않았다(스텁은 그대로 남아 있다 — 교체는 배선).
- **저장소를 포트로 뒤집었다**(`MatchArchiveStore` = `findMemberNicknames` + `insert`).
  4.3(`user/profile.ts`)과 같은 이유: 이 환경에 MySQL이 없어서, 판정 로직(멱등·닉네임
  우선순위·회원/게스트 분기·시계)이 MySQL 없이 돌아야 한다. 실제로 틀리는 자리는 전부
  서비스 쪽이고 그쪽은 항상 돈다.
- **회원 조회를 `findMemberNicknames` 하나로 합쳤다.** Java는 참가자마다
  `users.findById(playerId)`를 부르고(N+1) 그 결과를 회원 판정 **겸** 대체 닉네임으로
  쓴다. 같은 두 용도를 유지하면서 한 번의 `WHERE id IN (...)`으로 줄였다. 관측 동작은
  같다.
- **Java와 의도적으로 다른 것: 제약 위반의 갈래를 나눈다.** Java는
  `DataIntegrityViolationException` 전체(FK·길이·유니크)를 잡아 `false`("이미 저장됨")로
  뭉갠다. FK 위반은 "저장되지 않았다"는 뜻이라 false로 돌려주면 사라진 판이 조용해진다.
  errno **1062만** false이고 나머지는 던진다 — 2.7이 삼켜 `onArchiveFailure`로 흘리므로
  게임 종료는 그대로 진행되고 사실은 로그에 남는다. 4.2의 errno 승격과 같은 결이지만
  정책이 달라(`auth/errors.ts`의 `isMysqlIntegrityViolation`은 7개 errno를 한 갈래로 본다)
  **공유하지 않고** 내 디렉터리에 좁은 판정을 뒀다.
- **`existsByGameId` 사전 확인을 insert와 같은 트랜잭션 안으로 넣었다.** Java는
  `@Transactional` 메서드 안의 두 리포지토리 호출이라 결과가 같다. 사전 확인이 히트하면
  아무것도 쓰지 않고 롤백한다.
- **시계는 `now: () => Date` 주입.** Java `Clock.systemUTC()`에 해당하는 "UTC"는 Node에서
  `Date`(순간)가 아니라 **풀의 `timezone: 'Z'`**(4.1)가 만든다. 그래서 서비스 주석과
  persistence.md에 "Date는 순간, UTC 벽시계는 드라이버 설정"이라고 명시했다. 4.5는 이
  주입점으로 주 경계를 초 단위로 흔들 수 있다.
- **랭킹 캐시 evict를 포트로 열어 뒀다**(`RankingCacheInvalidator.invalidateAll`, optional).
  Java `@CacheEvict(allEntries = true)`가 메서드 프록시라 **중복 판·검증 실패 호출에도**
  비워지는데, 그 관용을 그대로 옮겼다(반환값으로 조건을 거는 복잡함보다 캐시 미스 1회가
  싸다 — Java `@implNote`). 다만 **무효화 실패는 삼킨다**: 행은 이미 커밋됐는데 캐시가
  남았다는 이유로 종료 경로에 실패를 보고하면 거짓말이 된다.
- **`player_count`를 참가자 배열 길이에서 뽑는다.** Java는 애그리거트가 `add()`마다 세는데
  (`Match.playerCount`), 값을 따로 들고 있으면 어긋날 수 있다. 저장 직전에 세면 어긋날
  자리가 없다.
- **닉네임 규칙은 Java 그대로다 — 앞뒤 공백을 다듬지 않는다.** Java `trim()`은 이름이
  아니라 **절단**(20자)이고 공백이면 "플레이어"다. 방 이름은 이미
  `normalizeNickname`(1~20자, trim)을 통과했으므로 다듬을 것이 없다. `String.length`도
  양쪽 다 UTF-16 코드 유닛 기준이라 절단 결과가 같다.
- **탁구 AI 자리를 `archiveParticipants(input)`로 남겼다.** Java의 두 번째 오버로드
  (`archive(gameId, gameCode, roomCode, results)`)에 해당한다. `PingPongAiResultService`는
  아직 없으므로(다른 티켓) 호출자는 없지만, 보관 규칙이 두 벌로 갈라지는 것을 막으려면
  진입점이 여기 있어야 한다.
- ⚠️ **MySQL이 이 환경에 없다(4.1·4.2의 관찰과 동일).** `mysqld`·`mariadbd` 없음, docker
  데몬 소켓 없음(`docker` CLI만 있다). `matchArchiveStore.test.ts`의 **9건은
  `MYSQL_TEST_URL` 부재로 skip**됐고 한 번도 실행되지 않았다 — `MYSQL_TEST_URL`이 있는
  환경에서 첫 실행이 필요하다. `MYSQL_TEST_REQUIRED=1`로 게이트가 skip 대신 **실패**하는
  것은 확인했다. `matchArchiveService.test.ts`의 **16건은 실행돼 통과**했다.
- **4.5가 읽을 표면**: 테이블 `matches`(game_code·finished_at·id) ·
  `match_participants`(match_id·user_id·total_score) — 스키마는 동결(ADR-0005)이라 4.5도
  그대로 읽는다. 코드 표면은 `game/match/index.ts`의 `RankingCacheInvalidator`(4.5의 캐시가
  이것을 구현해 배선에서 주입) 하나뿐이다. **읽기 질의는 4.4가 만들지 않았다** — 랭킹
  select는 4.5의 저장소가 자기 파일에서 쓴다(보관은 쓰기 전용).

## 2026-08-14 - Phase 4.5 (주간 랭킹)

### 시간대 처리 — +9 산술 고정을 택했다 (Java는 시간대 DB)

Java는 `ZoneId.of("Asia/Seoul")`을 상수로 박고 `TemporalAdjusters.previousOrSame`을
쓴다. Node에는 `ZonedDateTime`이 없어 세 갈래가 있었다:

1. `Intl.DateTimeFormat`으로 `Asia/Seoul` 벽시계를 얻어 역산 — 시간대 DB를 실제로 읽음
2. `+09:00` 오프셋 산술 고정
3. 새 의존성(`date-fns-tz`·`luxon`) — ADR-0003(ORM 미도입)과 같은 결로 기각

**2번을 택했다.** 이 계산에 들어오는 시각은 "지금"과 "지금 + 7일" 뿐이고, 한국은
현재 서머타임이 없어(마지막 시행 1988년, +08:30 구간은 1961년까지) 그 범위에서
`Asia/Seoul`의 오프셋은 +09:00 하나다 — 즉 1번과 결과가 같다. 대신 결과가 Node의
ICU 빌드나 컨테이너 tzdata 버전에 걸리지 않는다.

**대가를 감시 장치로 갚았다.** `weekBoundary.test.ts`의
`Asia/Seoul의 실제 오프셋은 앞으로도 +9 하나다`가 2026~2029의 매달 1일·15일에
대해 `Intl`의 실측 오프셋을 모아 `{540}` 하나인지 본다. 서머타임이 되살아나면
"주 경계가 주말에만 조용히 틀리는" 형태가 아니라 **테스트 실패**로 먼저 드러난다.
같은 파일에 "감시 장치가 시간대 DB를 실제로 읽는다"를 붙여, ICU 없는 빌드에서
`Intl`이 존을 무시하고 UTC로 답하는 경우(오프셋 0)를 걸러 낸다.

`getUTC*` 게터로 KST 벽시계를 읽는 관용(오프셋만큼 옮긴 `Date`를 만들고 UTC
게터로 읽기)이 이 파일의 핵심 트릭이다. 로컬 게터를 쓰면 프로세스 TZ가 섞인다 —
4.1이 `timezone: 'Z'`로 막아 둔 것과 **같은 종류**의 스큐다.

### Java의 `@Cacheable`을 데코레이터로 옮겼다

Java는 캐시를 **리포지토리 메서드**에 붙인다(`MatchParticipantRepository.findWeeklyBest`).
Spring 프록시가 없는 Node에서 같은 자리를 잡는 방법은 데코레이터다 —
`CachingWeeklyRankingRepository`가 `WeeklyRankingRepository`를 구현하며 감싼다.

얻은 것: 서비스는 캐시의 존재를 모르므로 서비스 테스트가 캐시 유무와 무관하게
돈다. 그리고 Java에서 "캐시가 실제로 걸렸는가"를 확인하려면 MySQL 컨테이너를
띄우고 "리포지토리로 우회 삽입한 행이 보이지 않음"을 봐야 했는데(Java 통합 테스트
3종), 데코레이터는 **위임 호출 횟수**로 같은 것을 더 정확하게, MySQL 없이 본다.

`evictAll()`은 좁은 포트(`WeeklyRankingCacheEvictor`)로 뺐다 — 4.4의 보관
서비스가 랭킹 모듈 전체를 알 필요가 없다. `user/profile.ts`의
`SessionNicknameWriter`와 같은 관용.

### 집계 인터페이스를 랭킹 모듈에 뒀다 (Java는 전적 패키지)

Java에서 `findWeeklyBest`·`findWeeklyBestScoreOf`·`countMembersScoringMoreThan`은
`game/match/repository/MatchParticipantRepository`에 있다. Node에서는
`game/ranking/weeklyRankingStore.ts`에 뒀다 — **읽는 쪽이 소유**해야 4.4(쓰기)와
4.5(읽기)가 서로의 파일을 건드리지 않고 같은 테이블을 나눠 쓴다. 두 슬라이스의
실제 결합은 Flyway V2 스키마 하나뿐이라 인터페이스 위치가 결합을 바꾸지 않는다.

### JPA → raw SQL로 옮길 때 확인한 것

- Java의 `where p.user is not null`과 `p.user.id = :userId`는 **조인을 만들지
  않는다**(FK 컬럼 접근). 그래서 `findWeeklyBestScoreOf`·`countMembersScoringMoreThan`은
  `users`를 조인하지 않고 `user_id` 컬럼만 본다. `findWeeklyBest`만 닉네임 때문에
  `JOIN users`가 필요하고, 그 조인이 게스트 행을 빼는 실제 장치다.
- `IS NOT NULL`을 조인이 이미 보장하는데도 남긴 것은 Java와 같은 이유 —
  "회원만 센다"가 질의의 의도이고, 조인 방식이 바뀌어도 의도가 남아야 한다.
- 집계 질의는 매칭 행이 없어도 **한 줄(NULL)** 을 돌려준다 — 그게 "기록 없음"이다.
  `Number(null)`이 0이 되는 함정이 있어 `null`/`undefined` 판정을 `Number()`
  **앞**에 둔다. 이걸 뒤집으면 무기록이 0점(순위에 오름)으로 바뀌어 204 계약이 깨진다.
- `MAX()`·`COUNT()`는 드라이버·서버 버전에 따라 문자열로 올 수 있어 `Number()`로
  좁힌다(`socialAccountStore.test.ts`가 `Number(rows[0]?.n)`을 쓰는 것과 같은 이유).

### limit이 정수가 아닐 때 — Java의 400을 빈 본문으로 재현

Spring `@RequestParam int limit`은 `?limit=abc`에 타입 변환 실패로 400을 내고,
본문은 Spring이 만든 `{timestamp,status,error,path}`다. 그 모양은 프레임워크
흔적이라 계약이 아니므로 **400 + 빈 본문**으로 맞췄다(2.9의 score-candidates 400과
같은 판단). `?limit=`(빈 값)은 "주지 않은 것"으로 보아 기본값 100이다 — Spring도
빈 문자열을 `defaultValue`로 대체한다.

`1.5`·`1e3`도 400이다(정수 문자열만 통과). Java의 `int` 변환과 같은 범위다.

### 오류 표면은 프로필·auth 쪽(plain-text)이다

Java `RankingController`가 `ResponseEntity.body("session_expired")`로 **String**을
돌려주므로 `StringHttpMessageConverter`를 타 `text/plain`으로 나간다. 조회
REST(2.9)의 JSON `{code,message}`가 아니다. 프론트 mock(`src/mocks/restHandlers.ts`)이
`HttpResponse.text('session_expired', {status: 401})`로 흉내내고 있어 교차 확인됐다.
→ `http/errorResponse.ts`의 `sendCode`를 그대로 쓴다.

`routes/users.ts`(4.3)의 `authenticateMember`와 사실상 같은 함수를 복제했다.
공통화하지 않은 이유: users.ts는 다른 슬라이스 소유(이번 웨이브에 손대지 않는다)이고,
두 게이트가 우연히 같은 모양일 뿐 같은 이유로 움직이지 않는다 — 프로필은 "고칠
프로필이 없다", 랭킹은 "오를 자리가 없다"다. 세 번째 사용처가 생기면 `http/`로 올린다.

### ⚠️ 미검증 — MySQL 집계 SQL은 한 번도 실행되지 않았다

4.1·4.2·4.3과 같은 상황이다. 이 환경에 MySQL 서버가 없고(`mysqld`·`mysql`·
`mariadbd` 바이너리 없음) **docker 데몬도 없다**(`docker info` →
`/var/run/docker.sock` 없음). 그래서 `weeklyRankingStore.test.ts`의 13개는
`describeMysql` 게이트로 skip된다.

skip된 것이 실제로 무엇인가: 게스트 제외 · GROUP BY 최고점 · 반개구간 경계 ·
현재 닉네임 · 내림차순 · limit 절단 · 동점 번호(SQL 경로) · DISTINCT 카운트 ·
0점 vs 무기록 · 게임 코드 필터. **SQL 문법·ONLY_FULL_GROUP_BY 호환성도 함께
미검증이다.** MySQL이 붙는 즉시 이 파일을 먼저 돌려야 한다:
`MYSQL_TEST_URL=mysql://root:pw@127.0.0.1:3306 npx vitest run src/game/ranking`

그 대신 이 티켓의 **핵심(주 경계)** 은 게이트 밖으로 뺐다 — 4.5에서 조용히 틀릴 수
있는 유일한 곳이 주 경계 환산이고, 그게 skip되면 티켓이 검증되지 않는다.

### 4.4의 테이블과 어긋난 점 — 없음

`db/migration/V2__create_match_tables.sql`(= backend-java 원본의 바이트 사본)만
보고 질의를 짰다. `matches(game_code, finished_at)` · `match_participants(match_id,
user_id NULL, total_score)` 모두 그대로 쓴다. `game/match/**`는 읽지도 쓰지도
않았고(4.4 소유), 통합 테스트도 `MatchArchiveService`를 부르지 않고 SQL로 직접
행을 넣는다 — 읽기 질의를 4.4의 진행 상태에 묶지 않기 위해서다.

**단 하나 4.4와 맞춰야 할 계약: `finished_at`은 UTC 벽시계여야 한다.** 4.4가
`Clock.systemUTC()` 대신 프로세스 TZ를 쓰면 랭킹이 9시간 어긋난 주를 세고 복구할
방법이 없다. 4.4가 풀의 `timezone: 'Z'`를 그대로 쓰고 `new Date()`를 넣으면 맞다.

## 2026-08-14 - Phase 4.3 (프로필)

- **dual-write 순서를 Java와 반대로 잡았다(유일한 의도적 편차).** Java
  `UserProfileService.rename`은 `@Transactional` 안에서 `userService.renameSession`을
  부른다 → **Redis 쓰기가 DB 커밋보다 먼저**다. 커밋이 실패하면 세션에만 새 이름이
  남고 그 상태는 세션 TTL(30일) 동안 저절로 낫지 않는다. Node는 `DB → 세션` 순서라
  최악이 "DB는 새 이름·세션은 옛 이름"이고 다음 로그인(`openMemberSession`)이 맞춘다.
  응답 계약은 어느 쪽이든 동일하다. persistence.md에 기록.
- **GET/PATCH의 오류 비대칭은 quirk이고 재현했다.** Java `UserProfileController`는
  PATCH만 `IllegalArgumentException`을 잡는다 — GET에서 회원 행이 없으면
  `user_not_found`가 Spring 밖으로 나가 **500**이 된다. PATCH는 404다. 통일하고
  싶지만 "오류 표면의 비일관성이 계약"(PLANS.md 리스크)이라 그대로 뒀고 테스트로
  고정했다(`users.test.ts` — GET 500 / PATCH 404).
  - 도달 조건: 세션은 살아 있는데 `users` 행이 사라진 경우뿐. 실제로는 계정 삭제
    기능이 없어 도달 불가에 가깝다.
- **`sendDomainError`(errorResponse.ts)를 쓰지 않았다.** 그 헬퍼는 기본 404 +
  `invalid_nickname`·`invalid_game_code`만 400인데, Java 프로필 컨트롤러는 **기본
  400 + `user_not_found`만 404**로 갈래가 반대다. 지금은 두 코드밖에 없어 결과가
  같지만, 공용 헬퍼에 코드가 추가되면 프로필 응답이 조용히 바뀐다 — `users.ts`에서
  직접 `sendCode`로 매핑했다.
- **정규화가 조회보다 먼저다(Java 순서 그대로).** `normalizeNickname` → `read` →
  `update`. 없는 회원 + 잘못된 이름이면 `invalid_nickname`(400)이 이긴다. 순서를
  뒤집으면 404가 이겨 계약이 바뀐다.
- **`MemberUser` 타입을 `auth/socialProfile.ts`에서 가져다 썼다.** Java는
  `user/domain/User`가 정본이고 auth가 그걸 쓰지만, 4.2가 이미 같은 모양을
  `auth/socialProfile.ts`에 두었다. 재정의하면 두 모듈이 서로 다른 회원 표현을
  들고 갈라진다. 의존 방향(user → auth)이 Java와 반대인 것은 인지하고 있으며,
  타입만의 의존이라 순환은 없다. **정리한다면 `MemberUser`·`PLACEHOLDER_NICKNAME`을
  `user/`로 승격하는 쪽**(Java 배치와 일치)이지만 4.2 소유 파일이라 손대지 않았다.
- **`inTransaction` 헬퍼가 `auth/socialAccountStore.ts`와 중복이다.** 공통화하지
  않은 이유: ① 그 파일은 4.2 소유 ② 두 저장소의 오류 승격 정책이 다르다(가입은
  유니크 위반을 `DataIntegrityViolationError`로 승격해 경합 복구에 쓰지만, 개명은
  이미 정규화된 값만 써서 제약 위반 갈래가 없다). 4.4·4.5가 세 번째 사본을 만들게
  되면 그때 `infra/mysql.ts`로 올릴 것을 권한다(오케스트레이터 판단 사항).
- **MySQL 테스트는 이 환경에서 전부 skip된다.** `describeMysql`(ADR-0005 게이트,
  `MYSQL_TEST_URL`)을 그대로 썼다. 그래서 Java 4종을 **두 벌** 적었다 — 인메모리
  저장소 + 진짜 Redis(항상 돎, dual-write의 세션 절반과 순서·정규화 계약을 고정)와
  실 MySQL 판(행이 실제로 바뀌는가·없는 회원 판정). 한 벌만 뒀으면 MySQL 없는
  CI에서 4.3이 통째로 초록인 채 미검증이 된다.
- **`persistence.md`의 「저장소 분리」에 사실과 어긋난 문장이 남아 있다**(공유 절이라
  손대지 않음): "MySQL 쓰기는 게임 종료 시점의 전적 보관(archive) 한 곳"이라고
  되어 있는데 4.2(가입·프로필 채택)와 4.3(개명)이 이미 두 번째·세 번째 쓰기
  경로다. 원문의 의도는 "게임이 **진행되는 동안**"이라 완전히 틀린 것은 아니지만,
  오케스트레이터가 한 줄 다듬어 주면 좋겠다.
- `server.ts` 배선은 하지 않았다(소유 아님). `registerUserRoutes`만 export했고
  조각은 보고에 적었다. **배선하지 않으면 `/users/me`가 404**이며 컴파일·테스트는
  전부 통과한다(조용한 누락 경로).

## 2026-08-14 - Phase 2.7 (게임 종료)

- **Java의 협력자 6개를 좁은 포트로 뒤집었다**(`completion/completionPorts.ts`) —
  2.5가 `round/roundPorts.ts`에서 한 것과 같은 방식·같은 이유(병렬 티켓과의 컴파일
  의존 차단 + "도메인은 전송 계층을 모른다"). `CompletionBroadcaster` ·
  `CompletionPresence` · `CompletionRoomService` · `CompletionSnapshotService` ·
  `CompletionDeadlineScheduler` · `MatchArchivePort`.
  - `markPhase`의 phase 인자를 `'finished'` 리터럴로 **좁혔다**. `string`으로 넓히면
    메서드 인자 이변성 때문에 `RoomSessionRegistry.markPhase(_, WsRoomPhase)`가
    "대입은 되지만 불건전한" 상태가 된다. 종료가 찍는 phase는 실제로 하나뿐이다.
  - `__tests__/completionPorts.contract.test.ts`가 **양방향**을 고정한다: 진짜
    `RoomBroadcaster`·`RoomSessionRegistry`·`InMemoryRoundDeadlineScheduler`를 포트에
    대입해 호출까지 하고, 반대로 `GameCompletionService extends GameCompletionPort`(2.5)를
    타입 수준으로 확인한다. Redis·소켓이 필요한 `RoomService`·
    `RealtimeRoomSnapshotService`는 타입 수준 `extends`로만 본다.
- **Lua는 텍스트 그대로 옮겼다.** 반환 코드는 0/1 두 개뿐이고, 0이 사유를 나누지
  않는 것이 계약이다(모든 0에서 호출자가 할 일이 같다). 점수판 키를 스크립트 안에서
  조립하는 부분(단일 노드 전제)도 그대로다.
- **`REQUIRED_CATEGORIES`를 리터럴 12 대신 `SCORE_CATEGORIES.length`로 뒀다.** Java는
  12를 박아 뒀지만, 두 목록이 갈라지면 "제출은 되는데 게임이 안 끝나는" 상태가 된다.
  값은 같다.
- **랭킹 계산을 한 벌로 합쳤다.** Java는 `GameCompletionService.rankings()`와
  `GameResultCalculator`가 같은 정렬·경쟁 순위 규칙을 **두 번** 구현한다. 여기서는
  `rankTotals`(검증 없음, 빈 입력 허용 — 방송 경로)를 `calculateGameResult`(검증 +
  winner/tied/isTie — 2.9 `/results` 경로)가 재사용한다. 관측 동작은 양쪽 다 동일.
- **Java와 다르게 한 것(기록용)**
  - `calculateGameResult`가 **정수가 아닌 점수**도 거부한다. Java `Integer`에는 없는
    입력이라 대응 케이스가 없었다. 순위를 소수점으로 매기는 경로는 없다.
  - 검증 실패 예외는 `GameCompletionDomainError`(점수 도메인의 `ScoreDomainError`와
    같은 결). `errors.ts`의 `DomainError`(REST 소문자 코드 계약)를 상속하지 않는다.
  - `log.info`/`log.error`를 훅으로 뺐다(`onFinished`·`onArchiveFailure`) — 2.5의
    `onWarning`과 같은 이유. 전적 보관 실패는 **삼키되 관측 가능**해야 한다.
  - `readTotals`가 `Map<string, number>`다(Java `LinkedHashMap`). 순서에 의미가 없고
    (랭킹이 다시 정렬한다) playerId가 `__proto__` 같은 값이어도 안전하다.
- **동시성 테스트는 연결 8개로 걸었다.** 한 ioredis 연결에 8개를 던지면 파이프라인이
  직렬화돼 경합이 사라진다. `duplicate({ retryStrategy: () => null })` + `disconnect()` —
  재시도를 켜 두면 하네스가 서버를 내린 뒤 소켓 ENOENT가 스위트 밖에서 튄다(실제로 겪음).
- **로비 복귀 테스트는 `RoomService`를 그대로 쓴다**(1.3 구현). `RETURN_TO_LOBBY`는
  FINISHED에서만 통과하므로, 2.7이 붙은 지금부터 그 경로가 처음으로 자연스럽게 도달
  가능해졌다(IMPLEMENTATION_NOTES의 2.1 메모가 예고한 상태).
- **남긴 자리**: 전적 보관은 `noopMatchArchive`. 4.4는 이 상수를 실제 서비스로 바꾸기만
  하면 된다 — 호출 지점·오류 삼킴·인자(방 스냅샷 + 확정 순위)는 이미 서비스 안에 있다.
- **관측된 틈(내 범위 밖)**: `registry.markPhase(PLAYING)`을 아무도 부르지 않는 문제는
  2.1 메모대로 여전히 3.1의 몫이다. 종료 쪽은 `finished`를 찍지만, 시작 쪽이 비어 있으면
  게임 중 끊김이 `player_left`로 처리되는 상태는 그대로다.

## 2026-08-14 - Phase 2.8 (재접속 스냅샷·스위퍼)

> `backend/IMPLEMENTATION_NOTES.md`가 다른 에이전트 소유라 여기 남긴다.
> 오케스트레이터가 병합 시 옮겨 넣으면 된다.

### Java와 다르게 결정한 것

- **`scores`를 `Map` → 평범한 객체로 옮긴다.** Java `Map<String, ScoreBoard>`는
  Jackson이 JSON 객체로 직렬화하지만 **JS의 `Map`은 `JSON.stringify`가 `{}`로
  만든다.** 2.9의 `GameScoreQueryService.getScoreboards`는 playerId 오름차순을
  보존하려고 `ReadonlyMap`을 돌려주므로, 그대로 스냅샷에 실었으면 재접속
  클라이언트의 점수판이 **통째로 빈 객체로** 나갔다. `createYachtDiceState`가
  삽입 순서를 지킨 채 객체로 옮긴다(REST `/rooms/{id}/scores`가 같은 이유로 같은
  변환을 이미 하고 있었다 — `http/routes/gameQueries.ts:113`). 포트가
  `ReadonlyMap | Record` 둘 다 받고, 타입 수준 계약 테스트가 2.9와의 대입을 고정한다.
  **Node 이식에서만 생기는 함정이라 회귀 테스트를 따로 뒀다.**
- **`dice`·`held`를 null이 아니라 `undefined`로 둔다.** Java
  `@JsonInclude(NON_NULL)`과 같은 와이어 결과(키 자체 생략)를 만드는 방법이
  Node에서는 undefined다. null을 실으면 프론트가 "굴렸는데 값이 없다"로 읽는다.
- **실패를 `IllegalStateException` 하나가 아니라 이유 코드 둘로 나눴다**
  (`ROUND_NOT_INITIALIZED` / `DEADLINE_NOT_FOUND`). 둘 다 WS `INTERNAL`로
  매핑되므로 관측 동작은 같다. 나눈 이유: reconnect.md의 「알려진 틈」(pause된
  방 재접속 → 활성 마감 없음)을 3.1이 실측·판정하려면 두 실패를 구분할 수 있어야
  한다. 메시지 문자열만으로 가르는 것은 계약이 아니다.
- **주기 실행을 주입 가능한 시임(`SweepScheduler`)으로 뺐다.** Java는
  `@Scheduled(fixedDelay, initialDelay)`. 2.3 `DeadlineExecutor`와 같은 모양·같은
  이유이며, 덕분에 스윕 테스트가 5분 sleep 없이 결정적으로 돈다.
  `start()`는 멱등이고 `stop()`이 예약을 해제한다(Java에는 없는 수명 API — Spring이
  하던 일을 부팅 배선이 해야 한다).
- **`log.info`/`log.warn`을 훅으로 뺐다**(`onSwept`·`onError`). 2.5가 같은 이유로
  `onWarning`·`onDegraded`를 뺐다 — 로거를 주입하면 도메인이 로깅 설정에 묶인다.
- **바깥 계층을 전부 좁은 포트로 역전했다**(`reconnectPorts.ts`). Java는
  `RealtimeRoomSnapshotService`·`RoundSynchronizationService`·`RoundTimerService`·
  `GameScoreQueryService`·`RoomService`를 구체 타입으로 잡는다. 여기서 그대로
  했으면 2.9(조회)가 아직 흔들리는 동안 재접속 모듈의 컴파일이 묶였다.
  어댑터는 없고(구조적 만족) `__tests__/reconnectPorts.contract.test.ts`가
  대입 가능성을 고정한다 — 2.5의 `roundPorts.contract.test.ts`와 같은 장치.
- **방 스냅샷 타입을 제네릭으로 통과시킨다.** 재접속이 방 스냅샷에서 읽는 것은
  `phase` 하나뿐이고 나머지는 해석 없이 통과한다. 제네릭이면 `ws/protocol.ts`의
  `WsRoomSnapshot`을 import하지 않고도 반환 타입이 정확히 그것으로 좁혀져
  `GameModule.reconnect`의 시그니처에 그대로 들어간다.

### 발견 / 미해결

- **`YachtDiceState`가 `game/reconnect/`에 산다.** Java는 `game/yacht/`에 있지만
  그 디렉터리는 3.1 소유이고, 이 타입을 **만드는** 곳은 재접속 스냅샷뿐이다
  (3.1은 소비만 한다). 3.1이 자기 쪽에서 다시 선언하면 와이어 모양이 갈라진다 —
  필요하면 `game/yacht/`에서 재수출할 것.
- **pause된 방 재접속의 재현 조건을 확인했다.** `RoundTimerService.cancelRoom`이
  `activeDeadlines`를 지우므로 pause 후에는 `currentDeadline`이 undefined다 →
  스냅샷이 `DEADLINE_NOT_FOUND`로 실패한다(reconnect.md 「알려진 틈」과 일치).
  Java와 같은 동작으로 두었고, 고칠지는 3.1이 `resume()` 호출 여부와 함께 결정한다.
- **`RoomSessionRegistry.markPhase`를 부르는 곳이 아직 없다**(1.5·2.1 노트의
  미해결 항목 그대로). 그래서 재접속 스냅샷의 PLAYING 분기는 **3.1이
  `markPhase('playing')`을 붙이기 전까지 실전에서 도달하지 않는다** —
  실시간 병합 스냅샷이 Redis phase를 읽어 채우는 경로는 살아 있지만,
  방이 이미 사라진 fallback 경로는 레지스트리 phase에 의존한다.
- **스위퍼는 `RoomService.getSnapshot`을 방마다 한 번씩 호출한다**(Java와 동일).
  라운드 상태를 가진 방 수만큼 Redis 왕복이 생기지만 5분에 한 번이고 진행 중
  방은 많아야 수십 개라 배치하지 않았다.

## 2026-08-14 - Phase 2.9 (조회 REST)

- **`score-candidates`는 GET이 아니라 POST다.** 티켓 본문은 "GET
  `/games/{id}/score-candidates`"라고 적었지만 Java `ScoreCandidateController`,
  `game-modules.md`의 조회 REST 표, 프론트 `room/api/roomApi.ts`
  (`getScoreCandidates` → `method: 'POST'`)와 msw 목 핸들러가 **전부 POST**다.
  주사위 5개를 본문으로 받는 계산기라 GET일 수 없다. 와이어 계약 동결 원칙에 따라
  POST만 등록했다(GET 별칭도 만들지 않았다 — 계약에 없는 표면).
- **`GameResultCalculator`를 두 번 이식하지 않았다.** 2.7이 같은 웨이브에서
  `game/completion/gameResultCalculator.ts`로 이미 옮겼고 주석에 "조회 REST(2.9
  `/results`)가 쓴다"까지 적어 뒀다. 처음에 `game/query/gameResult.ts`로 따로
  썼다가 지우고 `../completion/index.js`의 `calculateGameResult`를 쓴다.
  → **결과: 2.9는 2.7에 컴파일 의존한다.** 두 브랜치가 함께 들어가야 한다.
  Java도 계산기를 한 벌만 두므로(`GameScoreQueryService`가 유일한 사용처) 이쪽이
  Java에 더 가깝다. 대신 점수 **출처**는 여전히 갈린다: `/results`는 점수판 해시의
  `_total`, `game.over`는 `room:{code}:scores` ZSET(Java와 같은 비대칭).
- **오류 표면이 방 REST와 정반대다.** 방·봇은 plain-text 소문자 코드,
  조회는 JSON `{code,message}` + 대문자 코드다. `errorResponse.ts`를 재사용하고
  싶어지는 자리인데 재사용하면 계약이 깨진다. 그래서 `queryErrors.ts`의
  `GameScoreQueryError`는 `errors.ts`의 `DomainError`를 **상속하지 않는다** —
  상속시키면 다른 라우트의 `sendDomainError`가 조회 오류를 텍스트 404로 바꾼다.
  (`ScoreConfirmationError`·`RoundSynchronizationError`와 같은 판단.)
- **이유 코드 이름 두 개가 응답에서 바뀐다**: `PLAYER_NOT_IN_ROOM` → `NOT_IN_ROOM`,
  `STORE_FAILURE` → `INTERNAL`. Java 컨트롤러의 switch가 그렇게 매핑한다 —
  도메인 이름을 그대로 내보내면 프론트가 못 알아본다.
- **빈 식별자의 상태 코드가 갈린다**: 빈 `roomId`는 404 `ROOM_NOT_FOUND`,
  빈 `requesterId`는 403 `NOT_IN_ROOM`. Java `validateIdentifier`가 필드마다
  다른 Reason을 넘기는 quirk 그대로.
- **읽기 재시도는 값이 아니라 "틀"만 본다.** 재검증 대상은 gameId·phase·
  게임→방 역매핑·roster 넷. 점수 값을 비교하면 진행 중인 게임에서는 거의 매번
  재시도하고 결국 500이 된다(확정 점수는 계속 늘어난다). Java도 같다.
- **재시도 테스트를 모킹 없이 재현했다.** Java `RedisGameScoreQueryStoreTest`는
  `RedisTemplate`을 모킹해 "읽는 사이 게임이 바뀐다"를 만든다. 여기서는 스토어가
  받는 타입을 `ReadOnlyRedis = {hget, hgetall}`로 좁히고, 테스트가 **진짜 Redis에
  위임하면서 첫 방 해시 읽기 직후 실제 HSET으로 게임을 바꾸는** 래퍼를 넣는다.
  값은 전부 Redis에서 나오므로 스토어가 스스로 계약을 정의해 버리지 않는다.
  ioredis `Redis`가 이 인터페이스를 구조적으로 만족해서 운영 배선은 그대로다.
- **`score-candidates`의 400을 "빈 본문"으로 맞추려고 캡슐화된 하위 스코프에
  `setErrorHandler`를 걸었다.** Fastify 기본 400 본문은
  `{statusCode,error,message}`인데 이건 프레임워크 흔적이지 계약이 아니다
  (1.4의 "Spring 기본 오류 본문은 흉내 내지 않는다"와 같은 판단, 다만 이번엔
  반대 방향 — 우리 흔적도 남기지 않는다). `app.register(async (scope) => …)`
  안에서만 유효하므로 같은 프리픽스의 방 REST에는 영향이 없다(테스트로 확인).
- 후보 계산은 `score/calculateScore`를 그대로 쓴다 — 불충족 → 0 규칙이 이미
  거기 있다. 점수판의 `null`(미기록)과 후보의 `0`(넣으면 0점)은 다른 뜻이라
  후보 응답에는 `null`이 한 개도 없어야 한다(테스트로 고정).
- 스코어보드 응답의 플레이어 키 순서는 스토어가 정한 **playerId 오름차순**이
  그대로 객체 키 순서가 된다(Java `LinkedHashMap`).
- ⚠️ 배선은 하지 않았다. `server.ts`는 다른 에이전트 소유라
  `registerGameQueryRoutes`만 export했다. 등록 전에는 `/rooms/{id}/scores`가
  조용히 404다.

## 2026-08-14 - 웨이브 2 배선

### 배선한 것 (server.ts / main.ts)

- **라운드(2.5)·점수(2.6)**: `InMemoryRoundStateStore` → `RoundSynchronizationService`
  → `RoundTimeoutResolver` → `RoundTimerService`. 점수는
  `ScoreConfirmationService(new RedisScoreBoardStore(redis))` +
  `ScoreRoundSubmissionService<RoundSubmissionResult>(roundSync, scores, rooms)`.
  타이머·해소기 모두 **WS 게이트웨이가 쓰는 그 `RoomBroadcaster`·`RoomSessionRegistry`**
  를 받는다. `InMemoryRoundDeadlineScheduler.stop()`을 `close()`에 연결했다.
- **소셜 로그인(4.2)**: `registerAuthRoutes`를 `/api/v1` 플러그인 안에 등록.
  `MysqlSocialAccountStore(mysql)` 하나가 `SocialAccountRepository`·`SocialAccountRegistrar`
  둘 다를 만족하므로 `new SocialLoginService(accounts, accounts)`로 넘긴다.
  `ServerOptions.mysql?: Pool` 추가, `ownsMysql`일 때만 `closeMysqlPool`.
- **마이그레이션 확인(4.1)**: `main.ts`에서만. 풀을 `main.ts`가 만들어
  `createServer(env, { mysql })`로 주입하고 종료 훅도 거기 둔다.

### 발견 1 — 라운드 포트는 어댑터가 없어서 배선이 유일한 검증 지점이다

`roundPorts.ts`의 포트들은 실제 클래스가 **구조적으로** 만족한다(어댑터 없음).
장점은 도메인이 전송 계층을 모른다는 것이고, 대가는 **잘못된 인스턴스를 넘겨도
타입이 통과한다**는 것이다. `new RoomBroadcaster()`를 한 번 더 쓰면:

- `broadcast`는 성공한다(구독자 0명) → round.start·score.update가 허공으로 나감
- `presence.find`가 항상 null → 접속자가 "오프라인"으로 판정 → 타이머가 아예
  안 걸리고 `start()`가 null을 반환 → 매 턴 스킵, 2턴이면 자동 퇴장

둘 다 로그도 예외도 없다. `roundPorts.contract.test.ts`는 *타입 호환*만 고정하지
*같은 인스턴스*는 고정하지 못한다 — 그 창을 `src/__tests__/serverWiring.test.ts`가
막는다(진짜 소켓으로 room.join → `timer.start` → `game.yacht_dice.round.start` 수신).
일부러 새 인스턴스를 넣어 실패하는 것까지 확인했다.

### 발견 2 — 4.2의 "배선 조각"은 코드가 아니라 문서 서술이었다

커밋 5620ad7은 server.ts를 건드리지 않았고, `docs/design/auth.md`의 「구현 위치」
표와 `persistence.md`의 "서버 기동(4.2에서 배선)" 줄만 남겼다. 그대로 붙여넣을
조각이 없었으므로 표면을 직접 읽어 조립했다. 실제로 달랐던 점:

- `AuthRouteDependencies.options`는 `Env`가 아니라 `AuthOptions`다
  (`authOptions(env)`로 변환해야 한다).
- `logins`는 저장소 두 개(`SocialAccountRepository`·`SocialAccountRegistrar`)를
  **따로** 받는다. 별도 트랜잭션 경계가 이유인데 MySQL 구현은 한 클래스가 둘 다
  구현하므로 같은 인스턴스를 두 번 넘기는 것이 맞다.
- `KakaoOAuthClient`/`GoogleOAuthClient`는 `ProviderConfig`를 받지 `AuthOptions`
  전체를 받지 않는다(2번째 인자 `SocialHttpOptions`는 테스트 전용 — 운영은 생략).
- `persistence.md`는 `verifyMigrations`를 "서버 기동"에 배선하라고 적었는데,
  기동 = `server.listen()`으로 읽으면 `ws/__tests__/gateway.test.ts`가 전부
  깨진다(그 테스트가 실제로 `listen()`을 부르고 이 환경엔 MySQL이 없다).
  `main.ts`가 정확한 자리다 — operations.md에 그 이유를 적어 뒀다.

### 발견 3 — `GameCompletionPort`(2.7)가 없어 스텁이 필요했다

`RoundTimerService`는 `gameCompletion.finishIfComplete`를 필수 의존으로 받는다.
2.7이 커밋되지 않았으므로 **항상 false + warn 로그**인 스텁을 넣었다. 결과:
라운드는 계속 진행되고, 라운드 상한에 닿으면 타이머가
`round_cap_reached_without_finish`로 멈춘다(게임이 조용히 안 끝나는 대신
경고로 드러난다). 작업 중 다른 에이전트가 `src/game/completion/`을 만들고 있는 것을
확인했다 — 커밋되면 이 스텁 자리(server.ts의 `gameCompletion`)를 그대로 교체하면 된다.

### 발견 4 — 기동 시 MySQL 왕복은 부팅 실패를 만든다(의도된 것)

`createMysqlPool`은 lazy라 MySQL 없이도 `createServer`는 성공한다(4.1 주석).
반면 `verifyMigrations`는 실제로 커넥션을 연다 — 즉 **`main.ts`에 넣는 순간
"MySQL 없으면 부팅 실패"가 계약이 된다.** Java(Spring Boot + Flyway
`validateOnMigrate`)와 같은 동작이고, 배포 검증이 `sleep 15` + Running 확인뿐이라
exit≠0이 유일한 신호이므로 그대로 두는 것이 맞다고 판단했다. 대신 그 왕복이
테스트 경로(`listen()`)에 새지 않도록 분리했다.

### 남은 배선 (내 티켓 밖 — 오케스트레이터 확인 필요)

- `RoundTimerService`를 **아무도 호출하지 않는다.** round.submit·dice.roll을
  받아 타이머를 돌리는 것은 3.1(야추 모듈)이고, WS 핸들러에는 라운드 진입점이
  없다. 지금은 `createServer()`가 돌려주는 `rounds`에 조립된 채 대기 중이다.
- `timer.removePlayer`가 WS 이탈 경로(`room.leave`·소켓 close)에 연결되어 있지
  않다 — `ws/handler.ts`·`game/lifecycle.ts`가 필요하고 둘 다 내 소유가 아니다.
- 2.7(completion)·2.8(reconnect)·2.9(query)·4.3(profile)이 작업 중 워크트리에
  나타났다. 전부 server.ts 배선이 필요하고 server.ts는 이 티켓의 소유 파일이므로
  **후속 배선 패스가 한 번 더 필요하다.**

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
