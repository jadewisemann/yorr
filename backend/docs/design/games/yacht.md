# 야추 (YACHT_DICE)

> 프레임워크 공통은 [game-modules.md](../game-modules.md). Java 원본:
> `game/yacht/`, `ws/dto/Dice*`. min 1 / max 6 / supportsBots **true**.
> 라운드·점수 파이프라인(RoundState·타이머·CONFIRM_SCORE)은 프레임워크 문서에
> 있고, 여기는 야추 고유 부분만 다룬다.

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

## 턴·주사위 상태기계

- 12라운드 × 참가자 순회(host 우선 정렬), 턴당 최대 3굴림, 주사위 5개 1..6.
- **RNG는 서버**(`nextInt(1,7)` ×5). 클라이언트 payload에는 의도(rollCount,
  held)만 있고 주사위 값이 없다. `round.submit`의 dice는 검증용 — 서버
  activeDice와 완전 일치 필수.
- rollCount는 서버 카운트+1과 정확히 일치해야 한다(연속성). 첫 굴림 전 hold
  거부. held 위치의 주사위는 다시 굴려도 이전 값 유지.
- 재접속 스냅샷에 rollCount·dice·held가 실린다 — 없으면 복귀한 클라이언트가
  0부터 세서 다음 roll이 거부된다([reconnect.md](../reconnect.md)).

## Redis 상태 스토어 (RedisYachtDiceStateStore)

- 키 `room:{code}:game:YACHT_DICE:state`, 값은 `YachtDiceStateSnapshot` JSON
  (roundNumber, totalRounds, participantOrder, submissions, activePlayerIndex,
  activeRollCount, activeDice, activeHeld, finished). 재접속용 DTO
  (`YachtDiceState`)와는 다른 모양이다.
- 모든 변이는 방 락(`…:state:lock`, SET NX, TTL 5초, 2초 스핀/10ms 간격,
  토큰 비교 Lua 해제) 아래에서 read-modify-write. 대기 초과는
  `game_state_busy`. **동시 동일 굴림 2건 중 정확히 1건만 성공**하는 통합
  테스트가 락의 계약이다.
- initialize는 SETNX(`ROUND_ALREADY_INITIALIZED`). TTL은 쓸 때마다 방 키의
  PTTL 복사(독립 TTL 없음).

## 채점 vs 봇 평가 (혼동 금지)

- `YachtScoreCalculator` = 룰북. 순수·정수·유일한 채점 권위.
- `ScorecardValueEvaluator` = **봇의 휴리스틱 가치 함수**(부동소수, 비영속):
  즉시 점수 + 상단 보너스 확보 가중(+35, 확보 프리미엄 4.0) + 남은 칸 기대값
  0.70 할인 + 보너스 도달 확률의 로지스틱 추정. 채점에 절대 쓰지 않는다.

## 봇 스택

```text
round.start 브로드캐스트 → RoundStartedEvent
 → BotTurnOrchestrator (2스레드 데몬 풀, 방별 세대 카운터)
     지연: 턴 시작 1200ms / 굴림 관찰 6500ms / 킵 선택 후 1500ms / 던지기 연출 600ms
 → YachtBotTurnCoordinator.executeIfCurrent (한 스텝 원자 실행)
     TurnVersion(라운드·활성자·rollCount·dice·held) 불일치 → 무시(스테일)
     rollCount==0 → 즉시 1굴림(held 전부 false)
     정책 결정: ExpectimaxYachtBotPolicy → 실패 시 LocalYachtBotStrategy 폴백
     SCORE 또는 3굴림 소진 → 정규 제출 경로(사람과 동일 파이프라인)
     HOLD → 킵 마스크 조정(dice.hold 발신) 후 관찰 재진입, 또는 즉시 다음 굴림
```

- 킵 조정은 **면(face) 개수 기준으로 기존 킵을 재사용**한다 — 같은 면이 이미
  킵돼 있으면 풀었다 다시 잡지 않는다(불필요한 hold 이벤트 방지).
- 봇은 `dice.thrown`은 내지만 `dice.shaken`은 안 낸다.
- Expectimax: 남은 리롤 수(0..2)가 깊이, 확률 노드는 다항 분포 **정확 계산**
  (샘플링 아님), (리롤 수, 면 카운트 base-6 인코딩) 메모이제이션, "다섯 개 다
  킵"은 SCORE로 표현. 조기 확정 마진 0.15. **2리롤 전체 탐색 < 1초**가 상시
  성능 계약(테스트로 고정).
- Local 폴백: 4연속 창(1-4/2-5/3-6)에서 3면 이상이면 스트레이트 킵, 아니면
  최빈 면(전부 단독이면 5 이상만), 카테고리는 점수 최대 + 고정 선호 타이브레이크.
- 실패 격리: 봇 태스크의 예외는 삼킨다 — 라운드 타이머가 폴백이다. 봇 턴은
  타이머 관점에서 절대 오프라인이 아니다.
- 종료까지 사람과 같은 경로를 탄다(2봇 12라운드 완주 통합 테스트 존재).

## 수명주기 구현 메모

- `start`: 잔여 상태 제거(방어) → initialize(라운드 1, host 우선 정렬) →
  phase PLAYING 마킹 → `state.sync` → 첫 턴 타이머. 예외 시 스스로 reset 후
  재throw(GameLifecycleService가 Lua 롤백).
- `reset`: 타이머 취소, 상태 삭제, WAITING 마킹, `state.sync`.
- `pause`: 타이머만. `resume`: 미완료 상태가 있을 때만 타이머 재무장.
- `removePlayer` → RoundTimerService.removePlayer(프레임워크 문서).
- `reconnect` → GameReconnectSnapshotService + 오프라인 카운터 리셋.

## 이식할 대표 테스트

- 서버 주사위 생성·broadcast 정확 문자열·msgId/roomId 에코·`auto:false`
  (`YachtTurnActionServiceTest`, `GameWebSocketHandlerTest`)
- hold는 타이머를 재시작하지 않는다 / 첫 굴림 전 hold는 INVALID_MESSAGE /
  비활성자 roll·throw는 NOT_YOUR_TURN, shake는 무음
- 점수 저장 실패 시 미제출 유지 + INTERNAL + 턴 비진행
- 동시 동일 변이 1건만 성공(Redis 통합), 스냅샷 라운드트립
- 봇: 스테일 세대 무시, 이미 킵된 중복 면 재사용, 3굴림 후 최선 카테고리 제출,
  야추 완성 즉시 제출, Expectimax 1초 예산, 2봇 완주
- 타임아웃: 마지막 held 유지 autoRoll, 굴림 소진 시 빈 카테고리 무작위 기록,
  유예 중 제출 시 STALE, 저장 실패에도 턴 진행
