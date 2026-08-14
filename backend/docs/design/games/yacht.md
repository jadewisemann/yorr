# 야추 (YACHT_DICE)

> 프레임워크 공통은 [game-modules.md](../game-modules.md). Java 원본:
> `game/yacht/`, `ws/dto/Dice*`. min 1 / max 6 / supportsBots **true**.
> 라운드·점수 파이프라인(RoundState·타이머·CONFIRM_SCORE)은 프레임워크 문서에
> 있고, 여기는 야추 고유 부분만 다룬다.
>
> 이식 상태: 모듈·상태 스토어·행동 서비스는 **3.1에서 이식 완료**(`src/game/yacht/`).
> 봇 스택도 **3.2에서 이식 완료**(`src/game/yacht/bot/`) — 배선만 오케스트레이터의 몫으로 남아 있다
> (「봇 배선」 참고).

## 구현 파일 (`src/game/yacht/`)

| 파일 | 책임 | Java 대응 |
|---|---|---|
| `yachtDiceGameModule.ts` | `GameModule` 구현 — 수명주기 훅 + 5메시지 라우팅 + 오류 매핑 + roomId 검증 | `YachtDiceGameModule` |
| `yachtTurnActionService.ts` | 사람·봇이 공유하는 행동 경계(roll/hold/submitScore) | `YachtTurnActionService` |
| `redisYachtDiceStateStore.ts` | `RoundStateStore`의 Redis 어댑터(방 락·SETNX·TTL 복사·SCAN) | `RedisYachtDiceStateStore` |
| `yachtDiceStateSnapshot.ts` | 저장 JSON ↔ `RoundState` 변환 | `YachtDiceStateSnapshot` |
| `payloads.ts` | 인바운드 payload 파싱(Java record의 관용을 그대로) | `ws/dto/Dice*Payload` |
| `yachtWsTypes.ts` | `game.yacht_dice.<event>` 조립, 인바운드 이벤트 목록 | `YachtDiceWsTypes` |
| `yachtPorts.ts` | 바깥 계층(ws·room·타이머·점수)을 잡는 좁은 포트 | (Java는 구체 타입 직접 주입) |
| `scripts.ts` | 락 해제 Lua(토큰 비교) | `RedisYachtDiceStateStore.UNLOCK` |

재접속 와이어 타입 `YachtDiceState`는 **`game/reconnect/`가 소유**한다(만드는 곳이
거기 하나뿐이다). 야추 배럴은 3.2·배선의 편의를 위해 재수출만 한다.

## WS 메시지 (접두사 `game.yacht_dice.`)

인바운드 5종 — 이 외는 `INVALID_MESSAGE`. 모두 envelope `roomId`가 세션의 방과
일치해야 한다(`NOT_IN_ROOM`).

| 이벤트 | payload | 성격 |
|---|---|---|
| `dice.roll` | `{roundNumber, rollCount, held:[b×5]}` | **상태 변경** — 서버가 주사위 5개 생성 |
| `dice.hold` | `{roundNumber, held:[b×5]}` | 상태 변경 — 킵 전체 교체(델타 아님), **타이머 연장 없음** |
| `dice.shake` | `{roundNumber, direction, strength}` | 순수 연출 릴레이. 비활성 플레이어는 **조용히 무시**(고빈도 메시지라 턴 교대 시 오류 스팸 방지). rollCount가 없는 것이 의도(굴림 번호가 생기기 전부터 흔든다) |
| `dice.throw` | `{roundNumber, rollCount}` | 순수 연출 릴레이. 비활성 플레이어는 `NOT_YOUR_TURN`(남의 그릇을 엎으므로) |
| `round.submit` | `{roundNumber, dice:[5], category}` | 점수 확정 파이프라인 진입 |

아웃바운드 — msgId 열은 요청 msgId 에코 여부.

| 타입 | payload | msgId |
|---|---|---|
| `dice.broadcast` | `{playerId, roundNumber, rollCount, dice:[5], held:[b×5], auto}` | 사람 굴림 ✓ / 타임아웃 autoRoll은 ✗ + `auto:true` |
| `dice.hold_changed` | `{playerId, roundNumber, held}` — broadcast와 분리된 이유: 클라이언트가 굴림 애니메이션을 재생하지 않게 | ✓ |
| `dice.shaken` | `{playerId, roundNumber, direction, strength}` | ✓ |
| `dice.thrown` | `{playerId, roundNumber, rollCount}` | 사람 ✓ / 봇 ✗ |
| `round.start` | `{roundNumber, deadline(epoch ms), activePlayerId, turnOrder}` — **같은 턴에서도 굴림마다 재전송**된다(마감 연장). 프론트는 (round, activePlayer)가 바뀔 때만 리셋 | ✗ |
| `round.end` | `{roundNumber, submitted:[playerId]}` | ✗ |
| `score.update` | `{playerId, scoreboard:ScoreBoard}` | 제출 응답 ✓(**프론트 제출 완결에 필수**) / 타임아웃 ✗ |
| `state.sync` | `{snapshot}` — 시작/리셋/종료 시 | ✗ |
| `game.over` | `{rankings:[{rank, playerId, total}]}` | ✗ |

- msgId 에코의 또 다른 용도: `dice.broadcast`에 자기 msgId가 돌아오면 프론트가
  "내 굴림" 물리 애니메이션 모드를 켠다(없으면 관전자 연출로 강등).
- `dice.broadcast`의 held: 사람 굴림은 **클라이언트가 보낸 held를 에코**,
  autoRoll은 서버 상태의 activeHeld.
- 반대로 `dice.hold_changed`의 held는 **서버 상태**(`activeHeld`)다. 굴림
  애니메이션이 없어 프레임 어긋남 문제가 없으므로 권위 값을 그대로 싣는다.
- msgId가 없는 요청의 응답 봉투에서는 `msgId` 필드가 **사라진다**(Java
  `@JsonInclude(NON_NULL)` — `JSON.stringify`가 undefined 속성을 지우는 것과 같은 결과).
- `error` 봉투는 roomId·msgId를 싣지 않는다. 짝은 payload의 `refMsgId`로만 맞춘다.

### 처리 순서 (5메시지 공통)

```text
roomId 검증(세션의 방과 일치) → payload 파싱 → [활성 플레이어 판정] → 도메인 호출
        ↓ 불통과                    ↓ 실패             ↓ 불통과
   NOT_IN_ROOM               INVALID_MESSAGE    shake: 무음 / throw: NOT_YOUR_TURN
```

- **payload 파싱이 활성 판정보다 먼저다**(Java 그대로). 남의 턴에 깨진 `dice.shake`를
  보내면 무음이 아니라 `INVALID_MESSAGE`가 나간다.
- `dice.roll`·`dice.hold`·`round.submit`은 별도의 활성 판정이 없다 — 라운드 도메인의
  `NOT_ACTIVE_PLAYER`가 그 역할을 하고, 그래서 오류 코드도 도메인 이유에서 나온다.
- payload 검증은 **의도적으로 관용적**이다. 없는 필드를 Java record의 기본값
  (int 0 / 참조 null)처럼 채워 도메인 검증에 걸리게 한다. 여기서 엄격하게 막으면
  같은 `INVALID_MESSAGE`라도 **턴 소유 검증보다 앞서게** 되어 응답이 갈라진다.

## 오류 매핑 (도메인 이유 코드 → WS 오류 코드)

`RoundSynchronizationError.reason`(2.2~2.5) → `error.code`:

| 이유 | WS 코드 | 대표 상황 |
|---|---|---|
| `PLAYER_NOT_IN_ROUND` | `NOT_IN_ROOM` | 방엔 있는데 이 판의 참가자가 아니다 |
| `NOT_ACTIVE_PLAYER` | `NOT_YOUR_TURN` | 남의 턴에 굴림·킵·제출 |
| `ALREADY_SUBMITTED` | `NOT_YOUR_TURN` | 같은 라운드 두 번 제출 |
| `ROUND_NOT_INITIALIZED` | `INTERNAL` | 라운드 상태가 없다(정상 경로로는 불가) |
| 그 밖의 전부 | `INVALID_MESSAGE` | `ROUND_MISMATCH`·`INVALID_ROLL`(rollCount 불연속·첫 굴림 전 hold)·`INVALID_DICE`(서버 주사위 불일치)·`INVALID_CATEGORY`·`GAME_ALREADY_FINISHED` |

`ScoreConfirmationError.reason`(2.6) → `error.code`:

| 이유 | WS 코드 |
|---|---|
| `GAME_NOT_FOUND` | `ROOM_NOT_FOUND` |
| `PLAYER_NOT_IN_GAME` | `NOT_IN_ROOM` |
| `STORE_FAILURE` | `INTERNAL` |
| 그 밖의 전부(`INVALID_CATEGORY`·`INVALID_DICE`·`GAME_NOT_ACTIVE`·`ROUND_ALREADY_SCORED`·`CATEGORY_ALREADY_USED`) | `INVALID_MESSAGE` |

- 인자 검증 실패(Java `IllegalArgumentException`, 우리 `ScoreDomainError`·`DomainError`)도
  `INVALID_MESSAGE`다.
- ⚠️ **여기 없는 예외는 응답이 나가지 않는다.** 대표 사례가 방 락 경합의
  `game_state_busy`(`ConflictError`)다 — Java도 그 `IllegalStateException`을 잡지 않아
  Spring 밖으로 나가고 클라이언트는 아무 응답도 받지 못한다. 우리 쪽은 게이트웨이가
  잡아 로그를 남기고 소켓을 살려 둔다(관측 결과 동일). 새 오류 응답을 만들면 계약이
  넓어지므로 재현하기로 했다.

## 턴·주사위 상태기계

- 12라운드 × 참가자 순회(host 우선 정렬), 턴당 최대 3굴림, 주사위 5개 1..6.
- **RNG는 서버**(`nextInt(1,7)` ×5). 클라이언트 payload에는 의도(rollCount,
  held)만 있고 주사위 값이 없다. `round.submit`의 dice는 검증용 — 서버
  activeDice와 완전 일치 필수.
- rollCount는 서버 카운트+1과 정확히 일치해야 한다(연속성). 첫 굴림 전 hold
  거부. held 위치의 주사위는 다시 굴려도 이전 값 유지.
- 재접속 스냅샷에 rollCount·dice·held가 실린다 — 없으면 복귀한 클라이언트가
  0부터 세서 다음 roll이 거부된다([reconnect.md](../reconnect.md)).

### 수명주기 (모듈 훅 → 프레임워크)

```text
POST /rooms/{code}/games ─ GameLifecycleService ─ START Lua(phase PLAYING·gameId)
                                                        │
                                              module.start(roomCode, game)
        상태 제거(방어) → initialize(라운드 1, host 우선) → registry.markPhase('playing')
                        → state.sync 방송 → timers.start(첫 턴)
                                     실패 시 ↘ module.reset() 후 재throw → ROLLBACK_START
```

- **`markPhase('playing')`은 모듈의 일**이다(Java도 `YachtDiceGameModule.start`가 한다).
  이게 없으면 REST로 시작한 게임에 이미 붙어 있는 소켓의 레지스트리 phase가 `waiting`에
  머물러 ① 끊긴 플레이어가 offline이 아니라 `room.player_left`가 되고 ② 재접속의
  PLAYING 분기(스냅샷에 `game` 동봉)가 실전에서 도달하지 않는다. 1.5·2.1이 "3.1이
  채운다"고 남겨 둔 구멍이며 3.1에서 닫혔다.
- `reset`: 타이머 취소 → 상태 삭제 → `markPhase('waiting')` → `state.sync`.
- `pause`: 타이머만. `resume`: **미완료 상태가 있을 때만** 타이머 재무장.
- `close`: 타이머 + 상태 폐기(phase는 옮기지 않는다 — 방 자체가 사라진다).
- `hasState`: 라운드 상태 존재 여부 = 빈 방 유예 30초/10분 선택의 근거.
- `removePlayer` → `RoundTimerService.removePlayer`(이탈의 단일 경로).
- `reconnect`: **`snapshot()` 뒤에** `clearOfflineMisses()`. 순서가 계약이다 —
  스냅샷 조립이 실패하면 오프라인 결석 카운터가 **남는 것**이 의도된 동작이다
  (복귀에 실패한 사람은 복귀한 것이 아니다).
- `start`는 initialize 전에 잔여 상태를 지운다. 없으면 같은 방의 재게임이 SETNX
  (`ROUND_ALREADY_INITIALIZED`)에 걸려 시작 자체가 막힌다.

## Redis 상태 스토어 (RedisYachtDiceStateStore)

- 키 `room:{code}:game:YACHT_DICE:state`, 값은 `YachtDiceStateSnapshot` JSON
  (roundNumber, totalRounds, participantOrder, submissions, activePlayerIndex,
  activeRollCount, activeDice, activeHeld, finished). 재접속용 DTO
  (`YachtDiceState`)와는 다른 모양이다. **필드 이름·순서를 Java record 그대로
  유지한다** — 전환기에는 두 백엔드가 같은 키를 읽을 수 있어야 한다.
- 모든 변이는 방 락(`…:state:lock`, SET NX PX, TTL 5초, 2초 스핀/10ms 간격,
  토큰 비교 Lua 해제) 아래에서 read-modify-write. 대기 초과는
  `game_state_busy`. **동시 동일 굴림 2건 중 정확히 1건만 성공**하는 통합
  테스트가 락의 계약이다(락이 없으면 둘 다 `activeRollCount 0`을 읽어 둘 다 성공한다 —
  직렬화된 뒤에는 두 번째가 rollCount 연속성에 걸려 거부된다).
- 왜 Lua 하나가 아니라 락인가: 전이가 JSON을 도메인 객체로 되살려 `RoundState`의
  검증을 통과시키는 일이고, `submitAtomically`의 `beforeStateChange`가 **또 다른 Lua**
  (CONFIRM_SCORE)다. Lua 안에서 Lua를 부를 수 없다(Java 원본의 ponytail 주석: 작업이
  5초를 넘기면 상태+점수를 한 Lua로 합칠 것).
- 락 해제는 `finally`에서 **항상** 시도한다. 토큰 비교 덕분에 락을 못 잡고 나가는
  경로에서는 no-op이다 — 그게 토큰 비교의 두 번째 역할이다(첫째는 TTL 만료 후 남의
  락을 풀지 않는 것). 해제 실패는 삼킨다(TTL 5초가 같은 일을 한다).
- initialize는 락 없이 SETNX(`ROUND_ALREADY_INITIALIZED`). TTL은 쓸 때마다 방 키의
  PTTL 복사(독립 TTL 없음). **방 키에 TTL이 없으면 상태 키도 무기한**이고, 그 경우
  회수는 스위퍼(2.8)의 몫이다.
- `roomIds()`는 `room:*:game:YACHT_DICE:state` 패턴만 SCAN한다 — 스위퍼가
  duel·pingpong 상태를 걷어가면 안 된다.
- 손상된 스냅샷(파싱·검증 실패)은 `invalid_yacht_state`(`ConflictError`)로 드러난다.
  코드 문자열이 계약이라 원인 예외는 표준 `Error.cause`에 붙인다.

## 채점 vs 봇 평가 (혼동 금지)

- `YachtScoreCalculator` = 룰북. 순수·정수·유일한 채점 권위.
- `ScorecardValueEvaluator` = **봇의 휴리스틱 가치 함수**(부동소수, 비영속):
  즉시 점수 + 상단 보너스 확보 가중(+35, 확보 프리미엄 4.0) + 남은 칸 기대값
  0.70 할인 + 보너스 도달 확률의 로지스틱 추정. 채점에 절대 쓰지 않는다.
- 기준 기대값(ones 2.0 … choice 20.0 … yacht 3.0)은 **경험적 상수**다. 튜닝 대상이므로
  테스트는 절대값을 단정하지 않고 "두 선택 중 어느 쪽이 큰가"만 고정한다.

## 봇 스택 (`src/game/yacht/bot/`)

| 파일 | 책임 | Java 대응 |
|---|---|---|
| `botTurnOrchestrator.ts` | 연출 시계 — 지연 4종 + 방별 세대 가드 + `dice.thrown` | `BotTurnOrchestrator` |
| `yachtBotTurnCoordinator.ts` | 한 스텝 원자 실행 — TurnVersion·킵 재사용·폴백 전환 | `YachtBotTurnCoordinator` |
| `expectimaxYachtBotPolicy.ts` | 주 정책(정확 확률·메모·CPU 예산) | `ExpectimaxYachtBotPolicy` |
| `localYachtBotStrategy.ts` | 폴백 정책(탐색 없음) | `LocalYachtBotStrategy` |
| `scorecardValueEvaluator.ts` | 봇의 가치 함수 | `ScorecardValueEvaluator` |
| `botPorts.ts` | 행동·라운드 조회·방·점수·정책의 좁은 포트 | (Java는 구체 타입 직접 주입) |
| `botErrors.ts` | `BotDecisionError`·`BotSearchBudgetError` | (Java는 표준 런타임 예외) |

```text
round.start 브로드캐스트 → RoundStartedEvent (RoundTimerService의 onRoundStarted 훅)
 → BotTurnOrchestrator (방별 세대 카운터, setTimeout 시임)
     지연: 턴 시작 1200ms / 굴림 관찰 6500ms / 킵 선택 후 1500ms / 던지기 연출 600ms
 → YachtBotTurnCoordinator.executeIfCurrent (한 스텝 원자 실행)
     TurnVersion(라운드·활성자·rollCount·dice·held) 불일치 → 무시(스테일)
     활성자가 봇이 아니거나 gameId가 없으면 → 무시
     rollCount==0 → 즉시 1굴림(held 전부 false)
     정책 결정: ExpectimaxYachtBotPolicy → 실패 시 LocalYachtBotStrategy 폴백
     SCORE 또는 3굴림 소진 → 정규 제출 경로(사람과 동일 파이프라인)
     HOLD → 킵 마스크 조정(dice.hold 발신) 후 관찰 재진입, 또는 즉시 다음 굴림
```

- 봇의 **유일한 행동 진입점은 `YachtTurnActionService`**다(사람과 같은 경계). 세 호출
  모두 `msgId: null`을 넘겨 에코를 끈다 — 그래서 봇의 `dice.broadcast`·`score.update`에는
  `msgId`가 없고 프론트가 "내 굴림"으로 오인하지 않는다. 그 서비스가 `dice.shaken`을
  내지 않으므로 "봇은 shake를 안 낸다"는 **구조적으로** 성립한다.
- 킵 조정은 **면(face) 개수 기준으로 기존 킵을 재사용**한다 — 같은 면이 이미
  킵돼 있으면 풀었다 다시 잡지 않는다(불필요한 hold 이벤트 방지).
- 봇은 `dice.thrown`은 내지만 `dice.shaken`은 안 낸다. `dice.thrown`은 **오케스트레이터가
  직접** 방송한다(행동 서비스 밖) — 굴림이 성사된 스텝에만, 600ms 뒤에.
- 세대 가드의 함정: 굴림은 `actions.roll` → `timers.start` → `onRoundStarted`로 이어져
  **세대를 올린다.** 그래서 `dice.thrown` 예약은 자기 세대가 아니라 **그때의 최신
  세대**로 걸어야 한다(자기 세대로 걸면 항상 스테일로 버려진다). 반대로 `hold`는 타이머를
  다시 걸지 않으므로 세대가 그대로다 — "관찰 후 재진입"이 자기 세대로 성립하는 이유다.
- Expectimax: 남은 리롤 수(0..2)가 깊이, 확률 노드는 다항 분포 **정확 계산**
  (샘플링 아님), (리롤 수, 면 카운트 base-6 인코딩) 메모이제이션, "다섯 개 다
  킵"은 SCORE로 표현. 조기 확정 마진 0.15. 킵 후보의 **열거 순서가 계약**이다
  (기대값이 완전히 같은 두 킵의 승자를 그 순서가 정한다).
- Local 폴백: 4연속 창(1-4/2-5/3-6)에서 3면 이상이면 스트레이트 킵, 아니면
  최빈 면(전부 단독이면 5 이상만), 카테고리는 점수 최대 + 고정 선호 타이브레이크.
  폴백이 "다섯 개 다 킵"을 말하면 그것은 리롤이 아니라 **제출**로 해석한다.
- 실패 격리: 봇 태스크의 예외는 삼킨다 — 라운드 타이머가 폴백이다. 봇 턴은
  타이머 관점에서 절대 오프라인이 아니다.
- 종료까지 사람과 같은 경로를 탄다(2봇 12라운드 완주 통합 테스트 존재).

### CPU 예산과 이벤트 루프 (Java와 다른 결정)

Java는 이 탐색을 **2스레드 데몬 풀**에서 돌렸다. Node는 단일 스레드라 탐색이 도는 동안
**관계없는 다른 방들의 WS 메시지·하트비트·라운드 마감이 그 뒤에 줄을 선다.** 그대로
인라인 이식하면 실전 지연이 되는지 판정해야 했다.

**측정 먼저.** 이식한 정책의 `decide` 실측(Xeon 2.10GHz, Node 22):

| 굴림 번호 | 남은 리롤 | decide 1회 |
|---|---|---|
| 1 | 2 (전체 탐색) | **14–16ms** |
| 2 | 1 | 3.5ms |
| 3 | 0 (12칸 평가만) | 0.02ms |

2봇 12라운드 완주 통합 테스트 전체가 0.7초다(탐색 ~50회 포함). Java 테스트가 성능
계약으로 고정한 1초는 **실측의 60배 여유**인 상한이었다.

**결정: 인라인 유지 + 예산을 런타임 불변식으로 승격.** 근거:

- 이벤트 루프를 끊지 않고 점유하는 최대 단위는 **decide 하나(≈15ms, ARM Ampere A1
  기준 3배 느려도 50ms)**다. 라운드 마감 25s+1s·하트비트 90s에 비해 무해하다.
- **방 사이의 양보 지점은 이미 있다.** 오케스트레이터가 모든 스텝을 `setTimeout`으로
  예약하므로, 20개 방의 봇 턴이 같은 ms에 겹쳐도 20개의 **별개 매크로태스크**가 되어
  그 사이에 소켓 I/O가 처리된다. 즉 최악이 "600ms 블록"이 아니라 "15ms 블록 20개"다.
- 부하 산정: 봇 턴 하나가 최소 1.2+6.5+1.5초의 지연을 쓰므로 방 하나가 만드는 무거운
  탐색은 **8초에 1회** 정도다. 20개 방이 전부 봇이어도 ≈2.5회/초 × 15ms ≈ **한 코어의 4%**
  (Ampere A1에서 ~12%).

**기각한 대안과 대가:**

- `worker_threads` 풀: 블록을 완전히 없애지만 ① 워커 엔트리 파일이 `src/`(vitest·tsx)와
  `dist/`(빌드) 두 경로에서 해석돼야 하고 ② 풀 수명·오류 전파·테스트 대역이 붙는다.
  15ms를 없애려고 이 복잡도를 사는 것은 지금 근거가 없다. 다만 `YachtBotPolicy` 포트의
  반환을 `BotDecision | Promise<BotDecision>`으로 넓혀 뒀다 — **코디네이터를 고치지 않고**
  구현만 교체할 수 있다.
- `setImmediate` 양보: 비용 분포가 고르지 않아(첫 킵 후보 하나가 메모의 대부분을 채운다)
  잘게 쪼개려면 재귀를 명시적 작업 큐로 바꿔야 하고, 그러면 **총 CPU가 늘어난다**.
  1초 예산의 의미도 벽시계로 바뀐다.

**예산 강제(Java에 없는 추가분).** `ExpectimaxYachtBotPolicy`는 메모 미스마다 경과
시간을 보고 `budgetMs`(기본 1000)를 넘기면 `BotSearchBudgetError`로 **스스로 중단**한다.
코디네이터가 그것을 잡아 `LocalYachtBotStrategy`(마이크로초급)로 내려가므로, 병리적
상황에서도 이벤트 루프 점유가 상한을 갖는다. 예산은 **주입 가능**하다 — 테스트가 실시간
1초를 기다리지 않고 초과 경로를 재현할 수 있어야 하고(시계를 주입한다), 운영에서 코어가
느려지면 값을 내릴 수 있어야 한다.

**재검토 조건**: 봇 결정 p99가 150ms를 넘거나, 동시 진행 방이 30개를 넘거나, 배포
대상 코어가 더 느려지면 worker 안으로 옮긴다.

### 봇 배선

야추 봇은 `server.ts`에서 조립하고, **3.1이 만든 인스턴스를 그대로 받는다**:

- `actions`는 야추 모듈이 받는 **그** `YachtTurnActionService`여야 한다. 새로 만들면
  봇의 굴림이 다른 브로드캐스터·타이머를 타고 나가는데 **타입도 테스트도 통과한다**.
- `rounds`·`rooms`·`scores`·`broadcaster`도 전부 위에서 만든 그것.
- 순환이 하나 있다: 봇 → 행동 서비스 → 타이머 → (`onRoundStarted`) → 봇. Java는
  `ApplicationEventPublisher`가 끊었고, 우리는 **늦은 바인딩 한 칸**으로 끊는다
  (`let yachtBots: BotTurnOrchestrator | null = null` → 타이머 옵션에서
  `yachtBots?.onRoundStarted(event)`).
- `close()`에서 `yachtBots.stop()`을 부른다. 지연 예약은 `unref`돼 프로세스를 잡지 않지만
  테스트에서는 스위트 간 누수가 된다(2.3의 `deadlineScheduler.stop()`과 같은 이유).

## 배선 (단일 인스턴스 공유가 계약)

야추 모듈이 받는 것들은 **WS 게이트웨이·봇 REST·라운드 타이머가 쓰는 그 인스턴스**여야
한다. 새로 만들면 빌드도 테스트도 통과하지만 방송이 허공으로 나간다(1.6에서 이미 한 번
겪었다):

- `broadcaster`·`seats`(레지스트리)·`realtimeSnapshots` → `server.ts`가 만든 그것
- `rounds`(`RoundSynchronizationService`)는 **`RedisYachtDiceStateStore` 위에** 올려야
  한다. 인메모리 스토어로 두면 재접속 스냅샷은 살지만 프로세스 재시작·다중 소비자
  경로에서 상태가 사라진다(2.4의 인메모리 구현은 테스트 시드다).
- 모듈 등록은 `GameModuleRegistry`(카탈로그를 흡수한 그것)에 `register()` 한 번.
  **`GameLifecycleService`도 같은 레지스트리를 받아야** REST 시작이 `module.start`를 부른다.

## 이식된 테스트 (3.1)

| Java | Node | 비고 |
|---|---|---|
| `YachtTurnActionServiceTest` | `__tests__/yachtTurnActionService.test.ts` | 제출 경로를 모킹하지 않고 진짜 `ScoreRoundSubmissionService`로 돌린다 |
| `GameWebSocketHandlerTest`의 dice·submit 케이스 | `__tests__/yachtDiceGameModule.test.ts` | 응답을 모듈이 만들므로 검증 대상이 모듈로 내려왔다. 브로드캐스터·레지스트리는 진짜(정확 JSON 문자열 검증) |
| `RedisYachtDiceStateStoreIntegrationTest` | `__tests__/redisYachtDiceStateStore.test.ts` | + 락 고갈·TTL 복사·SCAN·손상 스냅샷 |
| — | `__tests__/yachtPorts.contract.test.ts` | 좁은 포트 ↔ 실제 구현 대입 고정(2.5·2.6과 같은 이유) |

Java에 없어서 새로 쓴 것: rollCount 불연속 거부, 라운드 미초기화 → `INTERNAL`,
`dice.broadcast`의 held가 서버 상태가 아니라 에코임을 두 번째 굴림으로 고정,
깨진 shake의 검사 순서, `start`의 host 우선 정렬·phase 마킹·잔여 상태 제거,
`reconnect`의 스냅샷 → 카운터 리셋 순서(실패 시 카운터 유지 포함),
락 대기 초과 시 **남의 락을 풀지 않는지**, 방 키 TTL 없으면 상태 키도 무기한.

## 이식된 테스트 (3.2 봇)

| Java | Node | 비고 |
|---|---|---|
| `BotTurnOrchestratorTest` 3종 | `bot/__tests__/botTurnOrchestrator.test.ts` | + 지연 4종 값, 최신 세대 예약, 오류 격리, `stop()` |
| `YachtBotTurnCoordinatorTest` 9종 | `bot/__tests__/yachtBotTurnCoordinator.test.ts` | + held만 바뀐 스테일, gameId 없는 방, 폴백의 전체 킵 해석, 굴림 직전 턴 교대 |
| `ExpectimaxYachtBotPolicyTest` 11종 | `bot/__tests__/expectimaxYachtBotPolicy.test.ts` | + 예산 초과 중단(시계 주입), 리롤 없는 결정은 예산 무관, 입력 검증 |
| `LocalYachtBotStrategyTest` 4종 | `bot/__tests__/localYachtBotStrategy.test.ts` | + 창이 2면 이하일 때, 최빈 동률, 결정론적 타이브레이크 |
| `ScorecardValueEvaluatorTest` 2종 | `bot/__tests__/scorecardValueEvaluator.test.ts` | + 채워진 칸 평가 시 예외 |
| `YachtBotGameCompletionTest` | `bot/__tests__/yachtBotGameCompletion.test.ts` | 서버 RNG를 시드로 고정(2.5의 시임) — 실패가 재현 가능해야 한다 |
| — | `bot/__tests__/botPorts.contract.test.ts` | 좁은 포트 ↔ 실제 구현 대입 고정(3.1과 같은 이유) |

- 오케스트레이터 테스트는 **실시간 sleep도 가짜 타이머도 쓰지 않는다.** 지연 값은
  `DeadlineExecutor`(2.3의 시임)에 기록된 `delayMs`로 검증하고, 발화 순서는 테스트가
  직접 정한다(Java의 `ArgumentCaptor<Runnable>` 자리).
- 완주 테스트는 오케스트레이터를 쓰지 않는다 — 지연 4종을 실시간으로 기다리면 12라운드가
  몇 분이다. Java 테스트와 같이 코디네이터를 루프에서 직접 돌린다.
- 타임아웃 계열은 2.5(`roundTimeoutResolver.test.ts`·`roundTimerService.test.ts`)가
  이미 덮었다: 마지막 held 유지 autoRoll, 굴림 소진 시 빈 카테고리 무작위 기록,
  유예 중 제출 시 STALE, 저장 실패에도 턴 진행.
