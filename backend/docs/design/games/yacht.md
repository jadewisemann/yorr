# 야추 (YACHT_DICE)

> 프레임워크 공통은 [game-modules.md](../game-modules.md).
> min 1 / max 6 / supportsBots **true**.
> 라운드·점수 파이프라인(RoundState·타이머·CONFIRM_SCORE)은 프레임워크 문서에
> 있고, 여기는 야추 고유 부분만 다룬다.
>
> 이식 상태: 모듈·상태 스토어·행동 서비스는 **3.1에서 이식 완료**(`src/game/yacht/`).
> 봇 스택도 **3.2에서 이식 완료**(`src/game/yacht/bot/`) — 배선만 오케스트레이터의 몫으로 남아 있다
> (「봇 배선」 참고).

## 구현 파일 (`src/game/yacht/`)

| 파일 | 책임 |
|---|---|
| `yachtDiceGameModule.ts` | `GameModule` — 라우팅 |
| `yachtLifecycle.ts` · `yachtWsErrors.ts` | 수명주기 / 오류 |
| `yachtTurnActionService.ts` | 사람·봇이 공유하는 행동 경계(roll/hold/submitScore) |
| `redisYachtDiceStateStore.ts` | `RoundStateStore`의 Redis 어댑터(방 락·SETNX·TTL 복사·SCAN) |
| `yachtDiceStateSnapshot.ts` | 저장 JSON ↔ `RoundState` 변환 |
| `payloads.ts` | 인바운드 payload 파싱 |
| `yachtWsTypes.ts` | `game.yacht_dice.<event>` 조립, 인바운드 이벤트 목록 |
| `yachtPorts.ts` | 바깥 계층(ws·room·타이머·점수)을 잡는 좁은 포트 |
| `scripts.ts` | 락 해제 스크립트(토큰 비교) |

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
| `round.start` | `{roundNumber, deadline(epoch ms **또는 null**), activePlayerId, turnOrder}` — **같은 턴에서도 굴림마다 재전송**된다(마감 연장). 프론트는 (round, activePlayer)가 바뀔 때만 리셋. `deadline: null`은 시계 없는 판(연습 방 — game-modules.md 「RoundTimerService」)이고 프론트는 그때 타이머를 그리지 않는다 | ✗ |
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
- msgId가 없는 요청의 응답 봉투에서는 `msgId` 필드가 **사라진다** —
  `JSON.stringify`가 undefined 속성을 지우기 때문이다.
- `error` 봉투는 roomId·msgId를 싣지 않는다. 짝은 payload의 `refMsgId`로만 맞춘다.

### 처리 순서 (5메시지 공통)

```text
roomId 검증(세션의 방과 일치) → payload 파싱 → [활성 플레이어 판정] → 도메인 호출
        ↓ 불통과                    ↓ 실패             ↓ 불통과
   NOT_IN_ROOM               INVALID_MESSAGE    shake: 무음 / throw: NOT_YOUR_TURN
```

- **payload 파싱이 활성 판정보다 먼저다**. 남의 턴에 깨진 `dice.shake`를
  보내면 무음이 아니라 `INVALID_MESSAGE`가 나간다.
- `dice.roll`·`dice.hold`·`round.submit`은 별도의 활성 판정이 없다 — 라운드 도메인의
  `NOT_ACTIVE_PLAYER`가 그 역할을 하고, 그래서 오류 코드도 도메인 이유에서 나온다.
- payload 검증은 **의도적으로 관용적**이다. 없는 필드를 기본값
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

- 인자 검증 실패도
  `INVALID_MESSAGE`다.
- ⚠️ **여기 없는 예외는 응답이 나가지 않는다.** 대표 사례가 방 락 경합의
  `game_state_busy`(`ConflictError`)다 — 모듈이 잡지 않으므로 게이트웨이가
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
POST /rooms/{code}/games ─ GameLifecycleService ─ START 스크립트(phase PLAYING·gameId)
                                                        │
                                              module.start(roomCode, game)
        상태 제거(방어) → initialize(라운드 1, host 우선) → registry.markPhase('playing')
                        → state.sync 방송 → timers.start(첫 턴)
                                     실패 시 ↘ module.reset() 후 재throw → ROLLBACK_START
```

- **`markPhase('playing')`은 모듈의 일**이다.
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
  (`YachtDiceState`)와는 다른 모양이다. **필드 이름·순서를 그대로
  유지한다** — 전환기에는 두 백엔드가 같은 키를 읽을 수 있어야 한다.
- 모든 변이는 방 락(`…:state:lock`, SET NX PX, TTL 5초, 2초 스핀/10ms 간격,
  토큰 비교 스크립트 해제) 아래에서 read-modify-write. 대기 초과는
  `game_state_busy`. **동시 동일 굴림 2건 중 정확히 1건만 성공**하는 통합
  테스트가 락의 계약이다(락이 없으면 둘 다 `activeRollCount 0`을 읽어 둘 다 성공한다 —
  직렬화된 뒤에는 두 번째가 rollCount 연속성에 걸려 거부된다).
- 왜 스크립트 하나가 아니라 락인가: 전이가 JSON을 도메인 객체로 되살려 `RoundState`의
  검증을 통과시키는 일이고, `submitAtomically`의 `beforeStateChange`가 **또 다른 스크립트**
  (CONFIRM_SCORE)다. Redis 시절에는 Lua 안에서 Lua를 부를 수 없어 이렇게 나눴다. 지금은
  둘 다 동기 함수라 합칠 수 있지만, 계약이 바뀌지 않는 한 나눠 둔다.
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

| 파일 | 책임 |
|---|---|
| `botTurnOrchestrator.ts` | 연출 시계(지연 4종·세대 가드·`dice.thrown`) |
| `yachtBotTurnCoordinator.ts` | 한 스텝 원자 실행(제출·킵·굴림·폴백) |
| `yachtBotTurnGuard.ts` · `yachtBotHeldIdentity.ts` | 턴 동일성 / 킵 자리 |
| `expectimax*.ts` | 주 정책·탐색·확률·칸 선택 |
| `cooperativeBotPolicy.ts` | 탐색을 프로세스 전체에서 하나씩, 사이마다 양보하는 큐 |
| `localYachtBotStrategy.ts` | 폴백 정책(탐색 없음) |
| `scorecardValueEvaluator.ts` | 봇의 가치 함수 |
| `botPorts.ts` | 행동·조회·방·점수의 좁은 포트 |
| `botErrors.ts` | `BotDecisionError`·`BotSearchBudgetError` |

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
  타이머 관점에서 절대 오프라인이 아니다. **시계 없는 연습 방에서도 봇 턴의 폴백
  예약만은 남긴다**(방송되는 `deadline`은 여전히 null) — 이 폴백이 유일한 안전망이라
  같이 지우면 굴림 한 번 실패한 판이 영원히 멈춘다.
- 종료까지 사람과 같은 경로를 탄다(2봇 12라운드 완주 통합 테스트 존재).

### CPU 예산과 이벤트 루프

Node는 단일 스레드라 탐색이 도는 동안 **관계없는 다른 방들의 WS 메시지·하트비트·라운드 마감이
그 뒤에 줄을 선다.** 배포 대상이 0.5 vCore(Botkeep, ADR-0007)라 이 문제가 더 커졌다.

**실측**(2026-10-18, Neoverse-N1 코어 하나, 무작위 판 600개):

| 굴림 번호 | 남은 리롤 | decide 1회 |
|---|---|---|
| 1 | 2 (전체 탐색) | p50 13ms · p99 18ms · 최대 32ms |
| 2 | 1 | 수 ms |
| 3 | 0 (12칸 평가만) | 0.02ms |

**결정 1 — 서버에 둔다(클라이언트로 옮기지 않는다).** 봇은 서버 권위의 참가자다. 호스트
브라우저가 봇을 두면 ① 조작할 수 있고 ② 호스트가 나가면 봇이 멈추고 ③ 와이어 계약이 바뀐다.
위 수치로는 그 대가를 치를 근거가 없다. (탁구 AI는 원래 기기 안에서 돌고 결과만 보고한다.)

**결정 2 — 탐색을 프로세스 전체의 큐 하나로 직렬화한다**(`CooperativeYachtBotPolicy`).
예전 이 절은 "오케스트레이터가 스텝마다 `setTimeout`을 걸므로 20개 방의 봇 턴이 겹쳐도 그 사이에
소켓 I/O가 처리된다"고 했다. **틀렸다.** Node는 timers 단계에서 만료된 타이머를 전부 실행한 뒤에야
poll 단계(I/O)로 넘어가므로, 같은 시점에 만료된 탐색 N개는 연달아 돈다. 큐는 앞의 탐색이 끝나면
`setImmediate`로 한 바퀴 양보한 뒤 다음을 돌려, 막히는 단위를 "탐색 N개"에서 "탐색 하나"로 줄인다.

| 측정 | 큐 없음 | 큐 있음 |
|---|---|---|
| 별도 프로세스 에코 왕복 최대, 굴림 1 탐색 10개 동시 만료 | 160ms | 16ms |
| 번들 · CPUQuota 50% · 512MB · 방 30개 × 봇 5명, ping 왕복 p99 | 38ms | 17ms |
| 같은 조건, 최대 | 506ms | 93ms |

**대기 상한과 낡은 상태**(2026-10-19, 코드 리뷰 지적). 예산은 탐색 하나만 묶으므로 줄이 길면 뒤쪽
봇이 탐색 전에 오래 기다린다. 큐는 대기가 8개(`DEFAULT_MAX_QUEUED_SEARCHES`)를 넘으면 기다리지 않고
`BotQueueFullError`로 거절해 그 봇을 폴백 전략으로 두고, 코디네이터는 **결정 뒤에 턴을 다시 읽어**
그 사이 타임아웃이나 사람이 턴을 넘겼으면 아무것도 하지 않는다.

**settle 보장**(2026-10-19, 같은 리뷰). 큐는 포트 뒤에 비동기·외부 실행 구현이 올 수 있게
설계됐다. 그런 구현이 죽은 워커 등으로 영영 settle되지 않으면 `pending`이 회수되지 않아,
상한(8)개가 그렇게 되면 이후 **모든 방의 봇**이 조용히 폴백으로만 돈다. 그래서 한 탐색이
`DEFAULT_SETTLE_TIMEOUT_MS`(60초) 안에 끝나지 않으면 그 호출을 `BotDecisionError`로 거절하고
큐의 꼬리를 푼다. 정상 예산(250ms)보다 넉넉한 값이라 정상 탐색은 자르지 않는다.

**결정 3 — 예산 250ms**(예전 1초). `ExpectimaxYachtBotPolicy`는 메모 미스마다 경과 시간을 보고
예산을 넘기면 `BotSearchBudgetError`로 스스로 중단하고, 코디네이터가 `LocalYachtBotStrategy`
(마이크로초급)로 내려간다. 큐가 있어도 탐색 하나는 끊기지 않으므로 이것이 이벤트 루프 점유의
상한이다. 250ms는 정상 탐색(0.5 vCore에서 최대 100ms 안팎)이 닿지 않는 값이다.

**기각한 대안:** `worker_threads` — 0.5 vCore에서 CPU를 늘려 주지 못하고, 워커 하나가 메모리 수십
MB와 엔트리 파일 경로(`src`/`dist`/번들)·수명·오류 전파·테스트 대역을 더한다. 막히는 길이를
줄이는 것은 큐로 충분하다. `setImmediate`로 탐색 **안을** 잘게 쪼개기 — 재귀를 명시적 작업 큐로
바꿔야 해 총 CPU가 늘고, 예산의 의미가 벽시계로 바뀐다.

**재검토 조건**: 부하 측정(`npm run test:load`, 야간)의 ping p99가 100ms를 넘거나, 한 방의 탐색이
예산에 닿기 시작하면(대량 시뮬레이션의 "가장 느린 결정" 단언이 빨개진다) 다시 연다.

### 검증 (SQLite 방식)

| 스위트 | 보는 것 |
|---|---|
| `expectimaxOracle.test.ts` | 독립 오라클(`test/oracles/yachtBot.ts` — 자리 비트마스크 · 순서 있는 굴림 6^k · 채점 오라클)과 **모든 주사위 다중집합 252개 × 굴림 번호** 전수 대조. 경계 판 17개 + 시드 고정 무작위 판 |
| `botRobustness.test.ts` | 속성 퍼저(합법·결정론·주사위 순서 무관) · **예산 장애 주입 스윕**(시계를 N번째 읽기에서 초과시켜 모든 N을 훑는다 — SQLite의 malloc 실패 스윕) · 혼돈 완주(정책이 30%·100% 실패해도 12라운드 완주) · 대량 시뮬레이션(정책 평균 ≈ 178점 > 폴백 ≈ 103점) |
| `cooperativeBotPolicy.test.ts` | 큐의 순서·직렬화·실패 격리, **별도 프로세스 서버**를 상대로 한 실제 굶김 측정 |
| `test/load/botLoad.load.test.ts` | 실제 서버(또는 `E2E_BASE_URL`의 번들)에 봇 방을 채우고 무관한 소켓의 ping 왕복 분위수를 잰다. 봇이 실제로 굴렸는지도 단언한다 |

오라클 대조가 찾은 것: `bestScore`가 "스몰 스트레이트가 충족되면 초이스를 뺀다"를 **결정을 바꾸지
않는 가지치기**라고 주석에 적고 있었다. 효용 기준으로는 초이스가 이길 때가 있어(빈 판의
[3,4,5,6,6]은 3.4 높다) 가지치기가 아니라 **규칙**이다. 이식한 테스트 「지켜낸 스몰을 기록한다」가
그 동작을 요구하므로 동작은 그대로 두고 주석을 고쳤고, 오라클에 규칙 5로 명시했다.

### 봇 배선

야추 봇은 `server.ts`에서 조립하고, **3.1이 만든 인스턴스를 그대로 받는다**:

- `actions`는 야추 모듈이 받는 **그** `YachtTurnActionService`여야 한다. 새로 만들면
  봇의 굴림이 다른 브로드캐스터·타이머를 타고 나가는데 **타입도 테스트도 통과한다**.
- `rounds`·`rooms`·`scores`·`broadcaster`도 전부 위에서 만든 그것.
- 순환이 하나 있다: 봇 → 행동 서비스 → 타이머 → (`onRoundStarted`) → 봇.
  `ApplicationEventPublisher`가 끊었고, 우리는 **늦은 바인딩 한 칸**으로 끊는다
  (`let yachtBots: BotTurnOrchestrator | null = null` → 타이머 옵션에서
  `yachtBots?.onRoundStarted(event)`).
- `close()`에서 `yachtBots.stop()`을 부른다. 지연 예약은 `unref`돼 프로세스를 잡지 않지만
  테스트에서는 스위트 간 누수가 된다(2.3의 `deadlineScheduler.stop()`과 같은 이유).
- `createServer`는 조립한 `botPolicy`를 돌려준다. `serverWiring.test.ts`가
  `CooperativeYachtBotPolicy`인지 확인해, 큐 래핑을 원복해도 타입·단위 테스트만 초록인
  상태를 막는다.

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

## 테스트

| 테스트 | 비고 |
|---|---|
| `__tests__/yachtTurnActionService.test.ts` | 제출 경로를 모킹하지 않고 진짜 `ScoreRoundSubmissionService`로 돌린다 |
| `__tests__/yachtDiceGameModule.test.ts` | 응답을 모듈이 만들므로 검증 대상이 모듈로 내려왔다. 브로드캐스터·레지스트리는 진짜(정확 JSON 문자열 검증) |
| `__tests__/redisYachtDiceStateStore.test.ts` | + 락 고갈·TTL 복사·SCAN·손상 스냅샷 |
| `__tests__/yachtPorts.contract.test.ts` | 좁은 포트 ↔ 실제 구현 대입 고정(2.5·2.6과 같은 이유) |

추가로 쓴 것: rollCount 불연속 거부, 라운드 미초기화 → `INTERNAL`,
`dice.broadcast`의 held가 서버 상태가 아니라 에코임을 두 번째 굴림으로 고정,
깨진 shake의 검사 순서, `start`의 host 우선 정렬·phase 마킹·잔여 상태 제거,
`reconnect`의 스냅샷 → 카운터 리셋 순서(실패 시 카운터 유지 포함),
락 대기 초과 시 **남의 락을 풀지 않는지**, 방 키 TTL 없으면 상태 키도 무기한.

## 테스트 (봇)

| 테스트 | 비고 |
|---|---|
| `bot/__tests__/botTurnOrchestrator.test.ts` | + 지연 4종 값, 최신 세대 예약, 오류 격리, `stop()` |
| `bot/__tests__/yachtBotTurnCoordinator.test.ts` | + held만 바뀐 스테일, gameId 없는 방, 폴백의 전체 킵 해석, 굴림 직전 턴 교대 |
| `bot/__tests__/expectimaxYachtBotPolicy.test.ts` | + 예산 초과 중단(시계 주입), 리롤 없는 결정은 예산 무관, 입력 검증 |
| `bot/__tests__/localYachtBotStrategy.test.ts` | + 창이 2면 이하일 때, 최빈 동률, 결정론적 타이브레이크 |
| `bot/__tests__/scorecardValueEvaluator.test.ts` | + 채워진 칸 평가 시 예외 |
| `bot/__tests__/yachtBotGameCompletion.test.ts` | 서버 RNG를 시드로 고정(2.5의 시임) — 실패가 재현 가능해야 한다 |
| `bot/__tests__/botPorts.contract.test.ts` | 좁은 포트 ↔ 실제 구현 대입 고정(3.1과 같은 이유) |

- 오케스트레이터 테스트는 **실시간 sleep도 가짜 타이머도 쓰지 않는다.** 지연 값은
  `DeadlineExecutor`(2.3의 시임)에 기록된 `delayMs`로 검증하고, 발화 순서는 테스트가
  직접 정한다.
- 완주 테스트는 오케스트레이터를 쓰지 않는다 — 지연 4종을 실시간으로 기다리면 12라운드가
  몇 분이다. 코디네이터를 루프에서 직접 돌린다.
- 타임아웃 계열은 2.5(`roundTimeoutResolver.test.ts`·`roundTimerService.test.ts`)가
  이미 덮었다: 마지막 held 유지 autoRoll, 굴림 소진 시 빈 카테고리 무작위 기록,
  유예 중 제출 시 STALE, 저장 실패에도 턴 진행.
