# 게임 프레임워크 (게임 무관 공통)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `game/module/`,
> `game/round/`, `game/service/`, `game/repository/`, `game/domain/`.
> 게임별 구현은 [games/yacht.md](games/yacht.md) · [games/duel.md](games/duel.md) ·
> [games/pingpong.md](games/pingpong.md).

## GameModule

게임 하나 = 모듈 하나(`src/game/module.ts`). Java `GameModule`과 동작은 1:1이고,
**메타데이터만 모듈에서 뺐다**(아래 표 주 참고). 훅은 전부 async다.

| 멤버 | 의미 |
|---|---|
| `code` | 대문자 정규 코드(`YACHT_DICE`·`DUEL`·`PING_PONG`). 레지스트리 키이자 WS 네임스페이스(소문자화) |
| `start(roomCode, game)` | phase 전이 **후** 게임 상태 초기화. `game`은 START 결과(`{gameId, snapshot}`). 실패 시 throw(롤백 유도) |
| `reset(roomCode)` | 로비 복귀 정리 |
| `reconnect(roomCode, playerId)` → `WsRoomSnapshot` | 재접속 스냅샷 생성([reconnect.md](../reconnect.md)). 게임 상태는 `game` 필드 |
| `pause` / `resume` | 타이머만 중단/재개, 상태는 그대로 |
| `removePlayer(roomCode, playerId)` | 게임 중 이탈 처리 |
| `close(roomCode)` | 방 소멸 — 타이머+상태 폐기 |
| `hasState(roomCode)` | 진행 중 게임 존재 여부(방 폐쇄 유예 선택에 쓰임) |
| `handles(event)` / `handle(socket, envelope)` | **접두사가 벗겨진** 이벤트명으로 라우팅. socket은 `ClientSocket` |

**`name`·`minPlayers`·`maxPlayers`·`supportsBots`는 모듈에 없다.** Java는 모듈이
세 값을 직접 들고 있지만(기본 1 / 6 / true), 우리는 `game/catalog.ts`의
`GAME_CATALOG`가 유일한 출처이고 레지스트리가 그 표를 흡수해
`registry.require(code)`로 돌려준다 — 모듈이 다시 선언하면 방 생성 정원(REST)과
시작 인원(Lua ARGV)이 두 곳으로 갈라진다. 게임 슬라이스는 카탈로그 행만 채운다.

`RoomGameHooks`(WS 코어가 쓰는 부분집합)는 이 인터페이스의 `Pick`이라 모듈이
그대로 들어간다.

### 레지스트리와 메시지 라우팅

- 코드 정규화: `trim().toUpperCase()`. 미지의 코드 → `invalid_game_code`,
  중복 등록·카탈로그에 없는 코드 등록은 기동 실패.
- **코드 조회와 모듈 조회는 다르다**: `require(code)` → 카탈로그 메타데이터
  (모르는 코드는 throw), `byCode(code)` → 등록된 모듈 또는 `undefined`
  (**던지지 않는다**). 카탈로그에는 세 게임이 다 있지만 모듈은 게임 슬라이스가
  하나씩 채우므로 "코드는 유효한데 모듈은 아직 없다"가 정상 상태다.
- WS 디스패치 규칙(`registry.dispatch`): 방의 gameCode로 모듈을 찾고, 메시지 type이
  `game.<code소문자>.` 접두사로 시작해야 하며(다른 게임 네임스페이스는 거부),
  접두사를 벗긴 이벤트명으로 `handles` 확인 후 같은 envelope(타입만 교체)로
  `handle` 호출. 어느 단계든 불통과면 `false`를 돌려주고 게이트웨이가
  `INVALID_MESSAGE`로 응답한다 — **모듈이 없는 게임 코드도 여기서 `false`다**
  (Java는 `require()`가 던져 응답이 아예 나가지 않는다).
- 모듈이 `handle`에서 던지면 잡지 않는다 — 게이트웨이가 로그만 남기고 소켓을
  살려 둔다(Java에서 예외가 `handleTextMessage` 밖으로 나가는 것과 같은 결과).
  **응답은 모듈이 스스로 보낸다.**
- 아웃바운드 타입 조립: `game.<code소문자>.<event>` (`gameWsType`, Java
  `GameWsTypes`). `game.over`·`state.sync`도 방의 게임 코드로 네임스페이스가 붙는다.
  코드·이벤트가 비면 `invalid_game_event_type`.

### GameLifecycleService

- `start(roomCode)`: 스냅샷 → 게임 결정(카탈로그 metadata + 모듈) → **Lua START**
  (phase/gameId 전이, minPlayers 검증) → `module.start`. 모듈이 던지면
  **ROLLBACK_START(gameId)** 후 재throw — 자기 게임만 되돌린다.
- 모듈이 없는 게임은 START까지만 하고 그대로 성공한다(되돌릴 상태가 없다).
- 배선: 생성자의 세 번째 인자가 레지스트리이며 **WS 게이트웨이와 같은 인스턴스**를
  넘겨야 한다. 기본값은 빈 레지스트리(= 모듈 훅 없음)다.
- `returnToLobby`: Lua RETURN_TO_LOBBY가 성공했을 때만 `module.reset`
  (RETURN_TO_LOBBY는 **FINISHED에서만** 통과한다).
- `removePlayer(roomCode, gameCode, playerId)`: REST 퇴장(`DELETE
  /rooms/{code}/players/me`)의 게임 중 경로. 게임 코드를 먼저 검증하고 모듈에 위임한다.
- pause/resume/close와 WS `room.leave`의 이탈은 이 서비스를 거치지 않고 WS 계층이
  모듈을 직접 부른다.

## 라운드 프레임워크 (야추가 사용, duel·pingpong은 자체 상태기계)

### RoundState (불변 도메인 객체)

- 필드: roundNumber, totalRounds(기본 12), participantOrder, submissions,
  activePlayerIndex, activeRollCount(최대 3), activeDice(첫 굴림 전 null),
  activeHeld, finished.
- 전이: `recordRoll`(rollCount는 정확히 +1 연속, 첫 굴림 전 hold 거부, held
  위치는 이전 주사위 유지) · `recordHold`(전체 배열 교체 — 델타 아님) ·
  `autoRoll`(서버 대리 굴림, activeHeld 재사용) · `submit`(**제출 dice가 서버
  activeDice와 완전 일치해야 함** — 불일치는 INVALID_DICE) · `expire`(무득점
  진행) · `withoutParticipant`(활성 플레이어는 직접 제거 불가 — 먼저 expire).
- 마지막 참가자가 끝나면 `complete`: 라운드 < totalRounds면 다음 라운드,
  아니면 `finished=true`(라운드 캡 안전망 — 진짜 종료 권위는 Redis Lua).
- 검증 순서 계약: `GAME_ALREADY_FINISHED` → `ROUND_MISMATCH` →
  `PLAYER_NOT_IN_ROUND` → `NOT_ACTIVE_PLAYER`.
- WS 오류 매핑: PLAYER_NOT_IN_ROUND→`NOT_IN_ROOM`, NOT_ACTIVE_PLAYER·
  ALREADY_SUBMITTED→`NOT_YOUR_TURN`, ROUND_NOT_INITIALIZED→`INTERNAL`,
  나머지(ROUND_MISMATCH·INVALID_*·GAME_ALREADY_FINISHED)→`INVALID_MESSAGE`.

전이표(모든 전이는 새 인스턴스를 돌려주고, 실패는 `RoundSynchronizationError`):

| 전이 | 선행 조건 | 결과 | 위반 시 reason |
|---|---|---|---|
| `recordRoll(p, r, n, held, dice)` | 활성 플레이어·라운드 일치, `n == activeRollCount+1` (1..3), held 5칸, dice 5개 1~6, **첫 굴림 전 held 전부 false** | activeRollCount=n, held 위치는 이전 dice 유지 | `INVALID_ROLL` · `INVALID_DICE` |
| `recordHold(p, r, held)` | 활성 플레이어·라운드 일치, **activeDice ≠ null** | activeHeld 전체 교체(rollCount·dice 불변) | `INVALID_ROLL` |
| `autoRoll(dice)` | `hasRollsLeft` | `recordRoll(활성, activeRollCount+1, activeHeld ?? 전부 false)` | `INVALID_ROLL` |
| `submit(submission)` | 활성 플레이어·라운드 일치, activeDice ≠ null, **dice 완전 일치**, 미제출 | 다음 참가자 / 라운드 완료 | `INVALID_DICE` · `ALREADY_SUBMITTED` |
| `expire()` | `finished == false` | 무득점으로 같은 진행 경로(advance) | `GAME_ALREADY_FINISHED` |
| `withoutParticipant(p)` | p가 참가자이고 **활성이 아님** | 순서에서 제거, `removedIndex < activeIndex`면 인덱스 −1. finished거나 비참가자면 **자기 자신 반환** | `INVALID_PLAYER` |
| advance(마지막 참가자) | — | round < totalRounds → 다음 라운드(제출 비움) / 아니면 finished=true, roundNumber 유지 | — |

불변식: ① 턴이 넘어가면 activeRollCount=0·activeDice·activeHeld=null ②
`finished`는 터미널 — recordRoll·recordHold·submit·expire 전부 거부(`autoRoll`은
recordRoll을 타므로 함께 막힌다) ③ 제출 기록은 이탈로 지워지지 않는다.

### 저장소 포트

- `RoundStateStore`: initialize(SETNX — 이중 초기화는 오류),
  `submitAtomically(roomId, submission, beforeStateChange)` —
  **beforeStateChange 콜백은 라운드 검증 후·상태 커밋 전**에 실행되고, 던지면
  상태는 무변화(점수 저장 실패 시 미제출 유지의 근간), recordRoll/Hold,
  autoRoll(턴이 지났으면 empty), expire(스테일이면 empty), removeParticipant,
  roomIds(스위퍼용), remove.
- 운영 어댑터는 Redis(야추 스토어, [games/yacht.md](games/yacht.md)) — 방 락
  (SET NX 5초 TTL, 2초 스핀) + JSON 스냅샷 + **방 키의 PTTL 복사**. 인메모리
  구현은 테스트 시드다.
- 완료된 게임은 스테일 턴으로 취급한다 — 취소 직전에 발화한 타이머가 끝난
  게임을 되살릴 수 없다.
- **포트는 전부 async다.** Java는 `ConcurrentHashMap.compute` 안에서 동기로
  원자성을 얻지만 여기서는 `beforeStateChange`가 Redis Lua(점수 확정)라 동기일
  수 없다. Node가 단일 스레드라도 콜백을 await하는 순간 같은 방의 다른 제출이
  끼어들 수 있으므로, **인메모리 구현은 방 단위 프라미스 락으로 "검증 → 콜백 →
  커밋" 구간을 직렬화**한다(Redis 어댑터는 방 락이 같은 역할). 이 직렬화가
  "두 개의 마지막 제출이 라운드를 두 번 완료하지 못한다"는 포트 계약이다.
- 빈 결과의 의미는 `Optional.empty` 자리의 `undefined`다 —
  autoRoll/expire/removeParticipant의 "이미 지난 턴·없는 방"과, 없는 방의
  `findByRoomId`가 같은 값을 쓴다(오류가 아니다).

### 마감 스케줄러 (RoundDeadlineScheduler)

- 인메모리, 방당 예약 1개, 세대(generation) 카운터로 재예약을 구분한다.
- **슬롯 등록이 executor.schedule보다 먼저다.** 이 순서가 핵심 회귀 수정이다:
  마감이 이미 지난 예약(delay=0)에서 워커가 슬롯 등록 전에 발화하면 "내 차례
  아님"으로 조용히 건너뛰고 그 방은 영원히 멈춘다(탁구에서 실제 발생, 야추도
  공유). **인라인 executor로 최악의 인터리빙을 재현하는 테스트를 반드시 함께
  이식한다.**
- `cancel(roomId, round)`는 라운드가 일치할 때만, `cancelRoom`은 무조건.
- Node 이식: Java `ScheduledExecutorService` 자리에 **`DeadlineExecutor` 시임**
  (`schedule(task, delayMs) → {cancel()}`)을 두고 기본 구현이 `setTimeout`+
  `unref`다. 세대 카운터는 `AtomicLong` 대신 평범한 숫자(단일 스레드).
  `unref` 때문에 예약만 남은 프로세스는 종료를 막지 않으며, `stop()`이
  `@PreDestroy`의 `shutdownNow()` 자리다.
- Node의 `setTimeout`은 스레드가 없어 **슬롯 선등록 레이스가 실제로는 생기지
  않는다.** 그래도 순서를 유지한다 — executor가 주입 가능한 시임인 이상
  (테스트의 인라인 executor, 향후 다른 어댑터) 순서 자체가 계약이고, 회귀
  테스트는 그 인라인 executor로 최악의 인터리빙을 결정적으로 재현한다
  (가짜 타이머로는 "schedule()이 반환하기 전 실행"을 만들 수 없다).
- 마감 작업은 `() => void | Promise<void>`다(타임아웃 해소가 Redis를 탄다).
  거부는 `onError`로 흘려 예약기를 살려 둔다 — 방 폐쇄 스케줄러와 같은 규약.

### RoundSynchronizationService (저장소 위의 얇은 응용 서비스)

- 하는 일은 둘뿐이다: WS 페이로드를 도메인 인자로 옮기고, **서버 주사위를 굴린다**.
  원자성·검증은 전부 `RoundStateStore`·`RoundState`가 갖는다.
- **주사위의 유일한 출처가 이 서비스의 `DieRoller` 시임**이다(DESIGN.md 원칙 1).
  `dice.roll`·`round.submit` 페이로드에 주사위를 만들 권한이 없고, 자동 굴림도
  같은 시임을 지난다. 테스트는 상수 롤러(`() => 1`)로, 재현이 필요한 판은
  `seededDieRoller(seed)`(mulberry32)로 고정한다 — Java에는 상수 공급자만 있었다.
- `submit`의 `beforeStateChange` 기본값은 no-op이다. 점수와 묶인 실제 제출 경로는
  2.6 `ScoreRoundSubmissionService`가 이 인자로 점수 확정을 끼워 넣는다.

### RoundTimerService (야추 턴 시계)

- 상수: 턴 25초, 만료 유예 1초(마감 직전 출발한 제출 흡수 — 클라이언트에는
  진짜 마감을 알리고 강제 진행은 +1초에 예약), 오프라인 허용 2턴.
- `start`: 활성 플레이어가 오프라인이면(봇은 절대 오프라인 아님) 타이머 없이
  오프라인 처리 — 1회차는 무득점 스킵, 2회차는 자동 퇴장. 온라인이면
  `roomService.touch`(방 TTL 슬라이딩 — 6인 12라운드가 40분을 넘는다) → 마감
  기억 → +1초에 강제 진행 예약 → `round.start{roundNumber, deadline,
  activePlayerId, turnOrder}` 브로드캐스트 → 봇 오케스트레이터용 이벤트 발행.
- `advanceTurn`이 "다음 턴 vs 종료"를 정하는 **유일한 합류점**(제출 경로와
  타임아웃 경로 공용): ① 끝난 라운드 타이머 먼저 취소(늦으면 이중 진행) ②
  점수 있으면 `score.update`(msgId 에코) ③ 라운드 완료면 `round.end` 후
  `finishIfComplete(gameCompleted)` — true면 정지 ④ finished인데 전이 실패면
  타이머 재무장 금지(경고만) ⑤ 아니면 다음 턴 start.
- `removePlayer`(게임 중 이탈의 단일 경로, 멱등): 오프라인 카운터 정리 →
  레지스트리 제거 → `roomService.leave` → `room.player_left` → 마지막
  참가자였으면 상태 통째 폐기, 활성 플레이어였으면 expire 후 제거 → advanceTurn.
  `room.player_left`는 **게임 네임스페이스가 붙지 않는다**(방 이벤트).
- **방송 순서가 계약이다**: `score.update` → `round.end` → `round.start`.
  마감 경로로 들어온 점수는 해소기가 이미 방송했으므로 타이머에는 `score: null`로
  전달된다 — 여기서 다시 쏘면 클라이언트가 중복 반영한다.
- Node 이식: `roomService.touch`·`leave`·`getSnapshot`이 Redis라 **`start`·
  `advanceTurn`·`removePlayer`가 전부 async다**(Java는 동기 `Instant` 반환).
  마감 작업 시그니처가 이미 `() => void | Promise<void>`라 그대로 얹힌다.
  `Instant` 자리는 epoch ms 숫자다.
- **바깥 계층은 전부 좁은 포트로 뒤집었다**(`roundPorts.ts`): 브로드캐스터·
  접속 명단(`RoundPresence`)·방 서비스·게임 종료(2.7)·점수 결합(2.6)·빈 족보
  조회(2.6). Java가 구체 타입 6개를 직접 잡는 자리다. 이유는 둘: 라운드
  프레임워크가 아직 없는 계층에 컴파일 의존을 만들지 않는 것, 그리고 "도메인은
  전송 계층을 모른다"(아래 「불변식」). 실제 구현(`RoomBroadcaster`·
  `RoomSessionRegistry`·`RoomService`·`ScoreRoundSubmissionService`·
  `ScoreConfirmationService`)이 **어댑터 없이 구조적으로 만족**하며, 그 대입
  가능성 자체를 테스트로 고정한다(`__tests__/roundPorts.contract.test.ts`).
- 아웃바운드 타입은 주입된 `gameCode`(기본은 `catalog.ts`의 `YACHT_DICE`)와
  `module.ts`의 `gameWsType`으로 조립한다 — Java `RoundTimerService`가 야추
  네임스페이스를 **정적 import로 못박은** 자리다. 라운드 프레임워크가 게임 하나에
  묶이지 않도록 주입으로 바꿨고, 조립 규칙 자체는 2.1의 헬퍼 하나만 쓴다
  (사본을 두면 접두사 규칙이 두 곳에서 갈라진다).

### 타임아웃 해소 (RoundTimeoutResolver)

1. 굴림이 남았으면 서버가 **autoRoll**(직전 held 유지)하고
   `dice.broadcast{auto:true}` 후 같은 플레이어로 25초 재시작.
2. 굴림 소진이면: 아직 비어 있는 카테고리 중 무작위 선택 → 서버 자신의
   주사위로 정규 제출 파이프라인 통과 → `score.update` 브로드캐스트 → 턴 진행.
3. 그 사이 플레이어가 제출했으면 STALE — 아무것도 안 한다.
4. **점수 저장 경로의 RuntimeException은 삼키고 무득점 진행으로 강등** —
   Redis 장애로 게임이 멈추면 안 된다.

강등(무득점 진행)으로 빠지는 가지는 넷이다: 주사위 없음(상태 손상) · 게임을
찾지 못함(`gameId` 없음) · 빈 족보 조회 실패 · 자동 기록 실패. 어느 쪽이든
`expire`로 턴만 넘기고, 그 `expire`마저 스테일이면 STALE이다 — **라운드 진행은
어떤 저장 실패에도 멈추지 않는다.** 관측은 `onDegraded(roomId, reason, error?)`
훅으로 뺐다(Java `log.warn` 자리).

- 결과 타입은 Java의 `record(kind, advanced, rolled)`(둘 중 하나만 채우고 나머지는
  null) 대신 **판별 유니온**이다. Java가 정적 팩터리 3개로 지키던 "kind를 보고
  꺼내라"는 규약이 타입으로 강제된다.
- 카테고리 선택은 `CategoryPicker(bound) → index` 시임이다(Java `IntUnaryOperator`).
  `Math.floorMod` 접기까지 그대로 옮겨 음수 인덱스도 범위 안으로 들어온다.
- 남은 족보는 **api key 문자열**로 주고받는다(`OpenCategoriesPort`) — `RoundSubmission`이
  카테고리를 문자열로 드는 것과 같은 경계다(라운드 → 점수 도메인 의존 금지).
- 완료된 게임(`finished`)은 STALE로 즉시 접는다. Java는 여기서 한 번 더 제출을
  시도했다가 `GAME_ALREADY_FINISHED`로 튕겨 같은 결론에 도달했다(부수효과는
  양쪽 다 없다 — 라운드 검증이 점수 확정보다 먼저라 점수는 기록되지 않는다).

### 고아 상태 스위퍼 (OrphanedRoundStateSweeper)

- 5분 고정 지연 스케줄. 라운드 상태가 있는 모든 방을 훑어 방 스냅샷의 phase가
  null(방 소멸)이면 `cancelRoom` → 상태 제거(순서 중요 — 만료가 없는 방을
  치지 않게).
- 존재 이유: 상태는 TTL로 죽지만 인메모리 예약·카운터는 안 죽는다.
- quirk: Redis 스토어의 `roomIds()`가 `room:*:game:YACHT_DICE:state` 패턴만
  SCAN한다 — **스위퍼는 야추만 청소한다**(duel·pingpong 상태는 자체 스토어가
  버전 체크로 방어).

## 점수 확정 파이프라인 (야추)

```text
WS round.submit{roundNumber, dice, category}
 → 모듈: 멤버십/roomId 검증, payload 파싱
 → ScoreRoundSubmissionService.submit
     → RoundSynchronizationService.submit → RoundStateStore.submitAtomically
         (라운드 검증: 활성 플레이어·라운드 번호·dice == 서버 activeDice)
         beforeStateChange 콜백 = ScoreConfirmationService.confirm
             → 방 스냅샷에서 현재 gameId 조회(없으면 GAME_NOT_FOUND, 확정 시도 안 함)
             → 카테고리 파싱, 서버가 YachtScoreCalculator로 점수 재계산
               (클라이언트 점수는 와이어에 존재하지도 않는다)
             → CONFIRM_SCORE Lua (아래) — 실패 시 throw → 라운드 상태 무변화
 → RoundTimerService.advanceTurn (score.update → round.end → 종료 판정/다음 턴)
```

### CONFIRM_SCORE Lua

KEYS: game:{id} / room:{code} / :players / scoreboard:{p} / score-submissions:{p}
/ :scores. ARGV: roomCode, gameId, playerId, roundNumber, category, score,
상단이면 `'1'`, requestSignature.

반환 코드 **10종**이 이 스크립트의 계약이다(가드 사다리 순서대로):

| 코드 | 의미 | reason |
|---|---|---|
| 1 | `game:{id}`에 roomCode 없음 | `GAME_NOT_FOUND` |
| 2 | game→room 매핑이 인자와 불일치 | `GAME_NOT_FOUND` |
| 7 | room 키 없음 | `GAME_NOT_FOUND` |
| 8 | room의 gameId가 인자와 불일치 | `GAME_NOT_FOUND` |
| 9 | phase ≠ PLAYING | `GAME_NOT_ACTIVE` |
| 3 | roster에 없음 | `PLAYER_NOT_IN_GAME` |
| 5 | 같은 라운드·같은 시그니처 | **멱등 재시도 — 성공 취급**, 점수 이중 반영 없음 |
| 4 | 같은 라운드·다른 시그니처 | `ROUND_ALREADY_SCORED` |
| 6 | 카테고리 이미 사용 | `CATEGORY_ALREADY_USED` |
| 0 | 성공 | — |

그 밖의 값은 계약 위반이라 `STORE_FAILURE`로 던진다(조용히 성공 처리하지 않는다).

- 시그니처 = `category:d1,d2,d3,d4,d5` — **주사위 순서에 민감**하다(재정렬된
  재시도는 4로 거부; quirk이자 계약).
- 집계는 스크립트 안에서: 상단 카테고리면 subtotal 가산, `보너스 = subtotal>=63
  ? 35 : 0`, `total = total + score + 새보너스 - 이전보너스`(보너스 이중 지급
  방지). 카테고리+메타 3필드+시그니처+방 누적 점수를 한 번에 기록, TTL 정렬.
- game↔room **양방향** 매핑 검증이 "오래된 게임 매핑으로 현재 방 점수 변경"을
  차단한다. 사전 room 코드 조회는 스크립트 밖이라 스테일이어도 가드 8이 잡는다.

### 점수 도메인

- `ScoreCategory` 12종(고정 순서): ones…sixes(상단) / choice, fourOfAKind,
  fullHouse, smallStraight, largeStraight, yacht. fourOfAKind는 야추로도 충족,
  fullHouse는 5장 동일로는 불충족(정확히 2+3), 스트레이트는 중복 제거 후 연속
  4/5.
- `YachtScoreCalculator`(순수·정적·유일한 채점 권위): 불충족 0 / 상단 해당 면
  합 / choice·fourOfAKind·fullHouse 전체 합 / small 15 / large 30 / yacht 50.
  상단 보너스 63→35.
- `ScoreBoard`: categories는 **항상 12키 전부**(미기록 null), 집계 3필드.
  null=미기록, 0=기록하고 희생 — 이 구분이 타임아웃 카테고리 선택과 종료
  판정의 근간이다.
- 점수판 해시의 집계 필드는 `_` 접두(`_upperSubtotal`·`_upperBonus`·`_total`)다.
  게임 종료 판정이 "`_` 비접두 필드 12개"로 완료를 세므로, 접두 없는 메타 필드를
  추가하면 종료가 영원히 성립하지 않는다.

### 구현 (`src/game/score/`)

| 파일 | 역할 |
|---|---|
| `scoreCategory.ts` | 12종 목록·상단 판정·족보 충족 판정 |
| `yachtScoreCalculator.ts` | 점수·상단 소계·보너스 (순수 함수) |
| `scoreBoard.ts` | 12키 정규화·동결, 빈 칸 열거 |
| `scripts.ts` | **CONFIRM_SCORE Lua** + 반환 코드 상수 |
| `scoreBoardStore.ts` · `scoreBoardMapper.ts` | 포트 + Redis 어댑터, 해시↔점수판 |
| `scoreConfirmationService.ts` | 서버 재계산 + 시그니처 |
| `scoreRoundSubmissionService.ts` | 라운드 제출과 점수 확정의 원자 결합 |

- Java enum(`ACES`…)의 상수 이름은 **옮기지 않았다** — 와이어·Redis 필드·조회
  응답 키가 전부 apiKey라 `'ones' | … | 'yacht'` 유니온 자체를 식별자로 쓴다.
- 라운드(2.5)와 점수(2.6)는 서로의 구체 타입을 import하지 않는다. 이어 붙는
  지점은 양쪽이 각자 선언한 좁은 포트뿐이고(`round/roundPorts.ts`의
  `ScoreRoundSubmissionPort`·`OpenCategoriesPort` ↔ `score/`의 `RoundSubmitPort`),
  그 대입 가능성은 `score/__tests__/scorePorts.contract.test.ts`가 고정한다.
- `ScoreCategory` 목록과 라운드의 `SUBMITTABLE_CATEGORIES`가 갈라지면 "제출은
  되는데 채점할 수 없는" 카테고리가 생긴다 — 두 목록의 동일성도 테스트가 지킨다.

## 게임 종료

- `GameCompletionService.finishIfComplete(roomId, force)`:
  ① Lua **FINISH_IF_COMPLETE** CAS — 실패면 **아무 부수효과 없음**(이 CAS가
  `game.over` 정확히 1회의 구조적 보장; 8스레드 동시 호출 테스트 있음)
  ② 스케줄러 cancelRoom ③ 레지스트리 FINISHED ④ 랭킹 계산 ⑤ 전적
  보관(archive) — **실패해도 삼킨다**(종료를 막지 않음) ⑥ `game.<code>.game.over
  {rankings}` → `game.<code>.state.sync{snapshot}` 순서 브로드캐스트(스냅샷이
  없으면 클라이언트가 phase 전환을 못 한다).
- Lua 판정: room 존재·PLAYING·gameId 일치 → force가 아니면 roster 전원의
  scoreboard에 `_` 비접두 필드 12개 이상 → FINISHED. force=true는 라운드 캡
  도달(타임아웃 구멍이 있어도 종료)과 duel·pingpong(자체 종료 판정)이 쓴다.
- 랭킹: 총점 내림차순·playerId 오름차순, **동점 공동 순위 + 다음 순위 건너뜀**
  (1,2,2,4). 점수는 서버가 확정한 Redis 값만.
- `GameAbortService`(`room.closed{not_enough_players}` 발신)는 **호출자가 없는
  데드 코드**다 — 게임 중 전원 이탈 시 실제로는 상태만 조용히 폐기된다.
  이식하지 않고, 프론트가 `room.closed`를 처리한다는 사실만 기억해 둔다
  (부활시키려면 별도 결정).

## 조회 REST

| 요청 | 응답 / 오류 |
|---|---|
| 🔑 `GET /api/v1/rooms/{roomId}/scores` | 200 `{playerId: ScoreBoard}` 맨 맵(12키+집계). PLAYING 또는 FINISHED 필요. 오류는 JSON `{code,message}`: 401 `AUTH_FAILED` · 404 `ROOM_NOT_FOUND` · 403 `NOT_IN_ROOM` · 409 `GAME_NOT_STARTED` · 500 `INTERNAL` |
| 🔑 `GET /api/v1/rooms/{roomId}/results` | 200 `{rankings:[{rank,playerId,total}], isTie}` — isTie는 **1위 동점일 때만** true. FINISHED 필요(409 `GAME_NOT_FINISHED`) |
| `POST /api/v1/games/{gameId}/score-candidates` | 200 `{candidates:{12키: 점수}}` — **인증 없음, gameId 미사용**(순수 계산기, quirk). 후보라서 불충족은 null이 아니라 0. 본문 검증 실패는 400(본문 없음) |

- 조회 스토어는 락 없이 **읽기→검증→재시도(최대 2회)**로 스냅샷 일관성을
  확보한다(gameId·phase·roster가 읽는 동안 변하면 재시도).

## 불변식

- **점수·판정은 서버가 재계산한다.** 클라이언트가 보낸 계산 결과를 신뢰하지
  않는다(주사위 물리 결과 포함 — DESIGN.md 원칙 1·2).
- **도메인 규칙은 전송 계층을 모른다.** 점수 계산·판정 로직은 WS·HTTP 타입을
  import하지 않는다.
- 점수 저장이 실패하면 그 플레이어는 **미제출로 남고 재시도할 수 있다** —
  라운드 상태 커밋과 점수 확정이 원자적으로 묶여 있어야 한다.
- 라운드 진행이 어떤 저장 실패에도 **멈추지 않는다** — 최악의 강등은 무득점
  진행이지 정지가 아니다.
- 게임 추가 시 손댈 곳: `game/<게임>/` 구현 + 레지스트리 등록. 게이트웨이·방
  로직은 건드리지 않는다.
