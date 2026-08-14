# 재접속

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본:
> `game/round/application/GameReconnectSnapshotService`·`OrphanedRoundStateSweeper`,
> `handler/GameWebSocketHandler`(재접속 분기), `ws/RoomSessionRegistry`.
> 구현: `src/game/reconnect/`(공개 표면은 `src/game/reconnect/index.ts`).

## 불변식

**재접속한 클라이언트는 증분 이벤트로 권위 상태를 재구성하지 않는다.**
서버가 내려주는 스냅샷이 새로운 동기화 기준점이며, 스냅샷 이전의 이벤트는
재구성된 상태에 영향을 주면 안 된다.

## 흐름 (실제 프로토콜 — `sys.reconnect` 메시지는 없다)

```text
client (저장해 둔 sessionToken 보유)
   ↓  WS 재연결
server → sys.connected (하트비트 재시작의 필수 신호)
client → room.join {roomId, sessionToken}     ← 최초 join과 같은 메시지
server
   ↓  토큰 검증 → 기존 좌석 발견(= 재접속 판정)
   ↓  좌석·host 플래그 유지한 채 소켓 교체
   ↓  이전 소켓에 sys.disconnect{replaced_by_new_session} → close 1008
   ↓  sys.reconnected { snapshot }   (roomId·msgId 에코)
   ↓  방 전체에 presence.update {playerId, status:"online"}
```

- 프론트는 REST 재참가를 하지 않는다 — 소켓 재연결(1초 고정 간격, 최대 10회)
  후 `room.join` 재전송이 전부다. 11회째 실패 시 세션을 보존한 채
  "disconnected"로 파킹한다.
- 좌석이 이미 없으면(유예 만료로 방이 닫혔거나 자동 퇴장) 일반 join 규칙이
  적용된다: LOBBY면 신규 입장, PLAYING이면 `GAME_ALREADY_STARTED`.
- 재접속 분기에서는 `room.joined`·`room.player_joined`가 나가지 않는다.

## 스냅샷 내용 (phase에 따라)

- phase가 PLAYING이 아니면: 실시간 병합 방 스냅샷 그대로(`game` 필드 생략).
- PLAYING이면 `snapshot.game`에 게임 상태 동봉:
  - **야추**: `{roundNumber, activePlayerId, roundDeadline, scores(전원
    ScoreBoard), turnOrder, rollCount, dice?, held?}` — 진행 중 턴의
    rollCount·dice·held가 **반드시** 실린다. 없으면 복귀자가 굴림 수를 0부터
    세서 다음 roll이 거부된다. 첫 굴림 전이면 rollCount 0에 dice·held 생략.
    라운드 상태나 활성 마감이 없으면 스냅샷 생성이 실패한다(→ `INTERNAL` +
    fanout 등록 해제).
  - **duel / pingpong**: 각자의 상태 객체(DuelState / PingPongState) 전체.
- 야추 reconnect는 오프라인 미스 카운터도 리셋한다 — 짧은 끊김이 자동 퇴장
  (2턴)으로 적립되지 않게.

### 야추 스냅샷 필드 계약 (`snapshot.game`)

정본은 프론트 `GameState`(`frontend/src/realtime/wsEvents.ts`)이고, 서버는
`GameReconnectSnapshotService`가 다음 순서로 조립한다:
**방 스냅샷 → 라운드 상태 → 활성 마감 → 점수판.**

| 필드 | 출처 | 없을 때 |
|---|---|---|
| `roundNumber`·`activePlayerId`·`turnOrder` | `RoundState` | 라운드 상태 없음 → 실패 |
| `roundDeadline` (epoch ms) | `RoundTimerService.currentDeadline` | 활성 마감 없음 → 실패 |
| `scores` (playerId → ScoreBoard) | 점수 조회(`GameScoreQueryService`) | 빈 객체 |
| `rollCount` | `RoundState.activeRollCount` | 첫 굴림 전이면 `0` |
| `dice`·`held` | `RoundState.activeDice`/`activeHeld` | **키 자체를 생략**(null로 싣지 않는다) |

- `dice`·`held`는 값이 없을 때 **키가 빠져야 한다**(Java `@JsonInclude(NON_NULL)`
  자리). 구현은 null 대신 `undefined`를 넣어 `JSON.stringify`가 지우게 한다.
- `scores`는 **평범한 객체**로 나가야 한다. 조회 계층은 playerId 오름차순을
  보존하려고 `ReadonlyMap`을 돌려주는데 `JSON.stringify(new Map())`은 `{}`다 —
  스냅샷 조립이 삽입 순서를 지킨 채 객체로 옮긴다(REST `/rooms/{id}/scores`가
  같은 이유로 같은 변환을 한다).
- 실패는 `ReconnectSnapshotError`다: 라운드 상태 없음 → `ROUND_NOT_INITIALIZED`,
  활성 마감 없음 → `DEADLINE_NOT_FOUND`. **둘 다 WS `INTERNAL`로 매핑**하며 그
  매핑은 게임 모듈이 한다(라운드의 `RoundSynchronizationError`와 같은 경계).
- 오프라인 미스 리셋은 **스냅샷 조립 뒤**다(Java `YachtDiceGameModule.reconnect`
  순서 그대로) — 조립이 실패하면 카운터는 남는다.

## 고아 라운드 상태 스위퍼

라운드 상태는 Redis TTL로 사라지지만 거기 딸린 **인메모리 자원**(마감 타이머
예약·오프라인 결석 카운트)은 TTL이 청소하지 않는다. 그것을 회수하는 경로는 빈 방
유예 타이머 하나뿐이고 그 예약은 프로세스 재시작에 사라진다 —
`OrphanedRoundStateSweeper`가 정확성을 받치고, 유예 타이머는 "빠른 회수"
최적화로 남는다. (keyspace notification은 at-most-once라 근거로 쓰지 않는다.)

- **주기 5분**(`SWEEP_INTERVAL_MS`). 이 값이 회수 지연의 상한이며 방 TTL(40분)보다
  충분히 짧으면 된다. 첫 실행도 5분 뒤다(Java `initialDelay = fixedDelay`).
- 판정: 라운드 상태를 가진 방마다 `RoomService.getSnapshot(roomId).phase`가
  **null이면 방이 사라진 것**이다(`roomNotFound` 스냅샷).
- ⚠️ **순서 불변식 — `timers.cancelRoom(roomId)` → `rounds.remove(roomId)`.**
  뒤집으면 상태를 지운 뒤 남은 마감이 발화해 방 없는 상태로 라운드가 되살아난다.
  타이머를 먼저 끊는 것이 계약이고 테스트가 순서 자체를 고정한다.
- 순회 목록은 **복사본**이어야 한다(`roomIds()`) — 도는 중에 `remove`를 부른다.
- 한 주기가 던져도 예약은 살아남고 다음 주기에 재시도한다(Spring `@Scheduled`와
  같은 결과). 주기 실행은 주입 가능한 시임이라 테스트가 실시간 sleep에 기대지 않는다.

## 소켓 끊김과 멤버십 (재접속의 전제)

- 끊김(1006 포함)은 방 나가기가 아니다. PLAYING 중 끊김은 좌석을 유지한 채
  OFFLINE 마킹 + `presence.update{offline}`만 한다. 오프라인 활성 플레이어의
  턴은 무득점 스킵되고, 2턴 연속이면 자동 퇴장된다([game-modules.md](game-modules.md)).
- 방의 마지막 소켓이 사라지면 타이머를 멈추고 유예(게임 중 10분/로비 30초) 후
  방을 닫는다. 유예 안에 누군가 join하면 취소되고 타이머가 재개된다.
- 같은 세션 토큰의 새 소켓이 이기고 옛 소켓이 진다(교체). 오프라인 좌석의
  복귀도 같은 경로다.

## 규칙

- 스냅샷은 그 시점의 화면을 그리기에 **충분**해야 한다 — 클라이언트가 부족분을
  추가 이벤트로 메꾸게 하지 않는다. 진행 중 턴 정보(rollCount 등)가 충분성의
  기준 사례다.
- 게임별 재접속 응답은 GameModule.reconnect가 만든다 — 프레임워크는 방 스냅샷,
  모듈은 게임 상태를 책임진다.
- 프론트 리듀서의 스냅샷 병합 규칙(서버가 지켜야 할 전제): 스냅샷에 `game`이
  있으면 서버를 신뢰하고, 없으면 로컬 game을 보존한다("game 없는 스냅샷이
  쌓인 score.update를 지우는" 사고 방지). FINISHED로 간 phase는 낡은 응답이
  되돌릴 수 없다.

## 알려진 틈 (Java 그대로 — 바꾸려면 결정 기록)

- 재접속 분기는 방 폐쇄 예약을 **취소하지 않는다**(최초 join 분기만 취소).
  좌석이 남아 있으면 발화 시점의 빈 방 재확인이 no-op이 되어 실전에서는
  가려진다.
- 재접속 분기는 `resume()`을 부르지 않는다 — pause로 타이머가 멈춘 방에
  재접속하면 활성 마감이 없어 야추 스냅샷 생성이 `INTERNAL`로 실패할 수 있다
  (최초 join 분기의 resume가 실행되는 "유예 취소" 경로에서만 재개된다).
  Java와 동일하게 두되, 이식 중 실측으로 재현 조건을 확인하고 고칠지 결정한다.
  → 2.8에서 **재현 조건은 확인했다**(`pause`가 `cancelRoom`으로
  `activeDeadlines`를 지우므로 `currentDeadline`이 undefined가 되고 스냅샷이
  `DEADLINE_NOT_FOUND`로 실패한다). 고치는 것은 3.1의 결정 — 이유 코드를
  분리해 뒀으므로 그때 이 가지를 골라낼 수 있다.
