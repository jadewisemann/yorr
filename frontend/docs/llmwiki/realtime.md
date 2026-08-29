# 실시간 통신 — WebSocket 계약·연결·재접속

> SSOT: [`../../src/realtime/wsEvents.ts`](../../src/realtime/wsEvents.ts) (와이어 계약),
> [`../../src/app/RealtimeSync.tsx`](../../src/app/RealtimeSync.tsx) (연결 정책·리듀서).
> 이 문서와 코드가 다르면 코드가 이긴다.

## 레이어 지도

| 파일 | 책임 |
|---|---|
| `realtime/wsEvents.ts` | FE/BE 공유 와이어 계약 SSOT — envelope, 전체 payload 타입, 메시지 유니온, 오류 코드, `WS_PROTOCOL_VERSION`, `buildClientMessage` |
| `realtime/realtimeClient.ts` | `WebSocketRealtimeClient` — **전송만 하는 멍청한 클라이언트**. 열기/닫기/JSON 인코딩/리스너 팬아웃. 재연결·heartbeat·큐 없음. `deliverLocal()`은 서버를 거치지 않고 도착한 봉투를 같은 팬아웃에 흘리는 유일한 주입 구멍이다([controller-link.md](./controller-link.md)) |
| `realtime/RealtimeClientContext.tsx` | DI 경계. `useRealtimeClient()`는 provider 밖이면 **던진다** (없으면 앱이 안 돌아가므로) |
| `realtime/fakeRealtimeClient.ts` | 테스트/mock 모드용 인메모리 클라이언트 — 보낸 메시지 기록, type별 핸들러 표, 지연·strict 모드 |
| `app/RealtimeSync.tsx` | **세션 엔진** — heartbeat, 재연결 스케줄링, rejoin, `ServerMessage → store` 단일 리듀서 |
| `room/connectSequence.ts` | 재연결 간격·시도 횟수 상수 — `RealtimeSync`와 컨트롤러 연결 UI가 **같은 체감 시간**을 쓰도록 한 파일로 모음 |

정책 분리가 이 레이어의 핵심 설계다: 전송(`realtimeClient`)에는 정책이 전혀 없고,
재연결·heartbeat·상태 반영은 전부 `RealtimeSync` 한 곳에 있다. 그래서 전송을
`FakeRealtimeClient`로 갈아끼우면 정책까지 통째로 테스트할 수 있다.

## 와이어 계약 (`wsEvents.ts`)

- **파일 전체가 팀 합의 기준이다.** BE(Java)는 import할 수 없으므로 같은 `type` 문자열/필드로
  DTO(record)를 미러링한다 — "이 .ts가 기준이고 Java가 따라온다."
- Envelope: `{ type, ts(서버가 채움), payload, roomId?, msgId? }`. `msgId`는 서버가 echo해
  요청-실패 상관관계(`refMsgId`)에 쓴다. `room.join`은 아직 방 밖이므로 envelope `roomId`가
  없고 payload로 방을 지정한다.
- **네임스페이스**: 방 레벨(`sys.*` `room.*` `reaction.*` `presence.*` `state.sync` `chat.*`)은
  접두사가 없고, 게임 모듈 이벤트는 v0.9부터 `game.<game_code>.` 접두사가 붙는다
  (`game.yacht_dice.*` · `game.ping_pong.*` · `game.duel.*`).
- 인증은 별도 `auth.*` 없이 `room.join`(닉네임+방ID+sessionToken)으로 병합됐다(v0.2).
- 타이머 tick 이벤트가 없다 — `round.start.deadline`(epoch ms)을 내려 클라가
  `(deadline - now)`로 계산한다. 서버 브로드캐스트 부하 제거.
  `deadline`(과 스냅샷의 `game.roundDeadline`)은 **null일 수 있다** — 제한 시간이 없는
  판(봇만 있는 연습 방)이고, 그때 화면은 타이머를 그리지 않는다([yacht.md](yacht.md)).
- `state.sync`는 diff가 아니라 **전체 스냅샷**이다. 2~6인 규모라 diff 비용이 없고, 메시지
  하나를 놓쳐도 다음 스냅샷에서 자동 복구된다. (`state.patch`는 선언만 있고 미사용)
- `dice.hold`도 증분이 아닌 **전체 `held` 배열** — 유실돼도 다음 토글에서 복구.
- 파생 점수(`total` 등)는 서버가 계산해 실어 보낸다. 클라 재계산 금지.
- `GameState.rollCount`는 재접속 전용 권위 필드다 — 없으면 재접속한 클라가 0부터 세어
  다음 `dice.roll`이 거부된다.
- 오류 코드: `AUTH_REQUIRED` `AUTH_FAILED` `SESSION_EXPIRED` `ROOM_NOT_FOUND` `ROOM_FULL`
  `NOT_IN_ROOM` `ALREADY_IN_ROOM` `GAME_ALREADY_STARTED` `NOT_YOUR_TURN` `INVALID_MESSAGE`
  `RATE_LIMITED` `INTERNAL`.

### 관전 연출 이벤트의 유래 (v0.6–v0.7)

- `dice.throw/thrown` — 던진 시점을 방에 알린다. 그전까지 관전자는 `dice.broadcast` 직후
  타이머로 사발을 쏟아, **굴린 사람이 아직 흔드는 중에 결과가 먼저 보였다.**
- `dice.shake/shaken` — 흔들림 펄스를 그대로 중계한다. 그전까지 관전 화면은 정해진
  애니메이션으로 계속 흔들려서, 굴린 사람이 손을 멈춰도 멈추지 않았다.

이 둘은 **서버가 판정하지 않고 그대로 중계만 하는 유일한 게임 메시지**다. 그래서 파티
모드에서는 서버를 거치지 않고 컨트롤러 폰 → 큰 화면으로 직접 가고, 링크가 붙어 있을 때만
그렇다 — 아니면 여기 적힌 대로 서버가 중계한다([controller-link.md](./controller-link.md)).
받는 쪽 코드는 어느 경로로 왔는지 모른다: 링크가 봉투를 서버와 같은 모양으로 만들어 같은
팬아웃에 넣는다.

### 알려진 계약 부채

- 계약 자체가 야추 모양이다 (`realtime/ → yacht/domain` import 예외). 게임 무관 envelope와
  게임별 payload로 가르는 것이 게임 추가의 실질 선행 작업.
- `RoomSnapshot.game` 타입이 야추 `GameState`라 탁구·석양 상태는
  `applyModuleGameState` 경계에서 캐스팅한다.
- `sys.reconnect`는 계약·mock에만 있고 실제로는 아무도 보내지 않는다 — 재접속은
  `room.join` + 서버 측 정체성 복원으로 동작한다(아래 참고).

## 연결 수명주기 (`RealtimeSync`)

```text
방 세션 있음 & 복귀 확인 대기 아님
  → connecting → client.connect()
      ├─ 'open'  → 대기 중 재연결 타이머 해제 → room.join{roomId, nickname, sessionToken}
      ├─ 'close' → heartbeat 중지 → 재연결 예약 (1초 후, 최대 10회)
      ├─ 'error' → heartbeat 중지만 (재연결은 뒤따르는 'close'가 예약)
      └─ message → 리듀서 적용; room.joined/sys.reconnected 수신 시
                   시도 횟수 0으로 리셋, status='connected'
```

- **Heartbeat**: `sys.connected`가 내려주는 서버 지정 주기로만 시작한다.
  `sys.ping { clientTs }` 전송. 서버(`HeartbeatMonitor`)는 주기 30초 × 3배 = 90초 무응답이면
  연결을 종료 경로로 보낸다 — ping이 멈추면 게임 중 강제 퇴장이다.
- **재연결은 지수 백오프가 아니라 고정 1초 간격 · 최대 10회다** (`connectSequence.ts`).
  짧으면 지하철 터널에서 시도만 태우고 끝나기 때문에 1초, 10회 초과 시
  `endSession('disconnected')` — 단 **토큰은 지우지 않고** 복귀 확인 상태로 멈춘다.
- 재연결 예약은 single-flight: 중복 `close`가 와도 예약은 하나만 유지한다.

### sessionToken 재접속 흐름

```text
REST 입장 → RoomSession{roomId, you, nickname, sessionToken}
          → localStorage 'yorr.room-session' (+40분 expiresAt, 방 Redis TTL과 동일)
소켓 open → room.join{roomId, nickname, sessionToken}
  BE: 기존 정체성 발견 → 게임 모듈 reconnect → sys.reconnected{snapshot} + presence ONLINE
      첫 입장            → room.joined{you, sessionToken, snapshot} + room.player_joined 브로드캐스트
  BE: 같은 플레이어의 옛 소켓에는 sys.disconnect{replaced_by_new_session} 후 종료 (1인 1세션)
```

복원은 절대 자동 입장하지 않는다 — 저장소가 복원돼도 사용자가 명시적으로
"이어서 하기"(복원) / "다시 연결"(연결 포기)를 고른 뒤에만 토큰을 서버에 제시한다
(`roomResumeReason` 게이트, 진입 화면 배너).

### 스냅샷 병합 불변식 — `keepGameState`

서버 전체 스냅샷(`state.sync` · `room.joined` · `sys.reconnected`)에는 게임 진행 상태(`game`)가
실려 있지 않을 수 있다. 그대로 갈아끼우면 `score.update`로 모아온 **모든 플레이어의 점수판이
통째로 사라진다.** 규칙:

1. 들어온 phase가 `waiting`이거나 현재 `game`이 없으면 → 서버 스냅샷 그대로 (로비 복귀는
   정당한 게임 상태 폐기)
2. 양쪽 다 `finished`면 → `players`와 `game` 둘 다 보존 (종료 시점 roster가 결과 화면
   닉네임의 유일한 원본)
3. 들어온 스냅샷에 `game`이 있으면 → 서버를 믿는다
4. 그 외 → 로컬 `game`을 서버 스냅샷에 접붙인다

### 리듀서의 비자명한 규칙들

- `round.start`는 새 턴에만 오지 않는다 — 서버는 굴림마다 마감을 연장하며 같은 턴에도 다시
  보낸다. 굴림 진행을 무조건 0으로 되돌리면 안 된다.
- `dice.broadcast`는 roomId/round/activePlayer 및 `rollCount >= 현재값` 가드를 통과해야
  반영된다 — 굴림 진행의 권위값은 서버.
- `game.over`는 뒤따르는 `state.sync`를 기다리지 않고 그 자리에서 `phase: finished`로 바꾼다
  — 메시지 순서에 의존하지 않기 위해서다.
- `game.ping_pong.state` / `game.duel.state`는 `snapshot.gameCode`가 일치할 때만 반영 —
  방을 옮기는 순간 도착한 늦은 메시지가 다른 게임 화면에 얹히면 크래시다.
- `error` 중 세션이 죽은 코드(`SESSION_EXPIRED`·`AUTH_*` → expired,
  `GAME_ALREADY_STARTED` → removed, `ROOM_NOT_FOUND` → room_closed)만 `endSession`으로
  보내고, 나머지는 복구 가능하므로 세션을 유지한다.

## 알려진 드리프트 (코드 확인 결과)

- 연결 `'error'` 이벤트는 재연결을 예약하지 않는다 — 복구는 브라우저가 뒤이어 내는
  `'close'`에 의존한다. 바이너리/깨진 프레임도 `'error'`로 떨어지므로 close가 올 때까지
  heartbeat가 멈춘다.
- `INVALID_ROLL`이 `rollCount` 주석에 언급되지만 `WsErrorCode`에는 없다.

방 텍스트 채팅은 [chat.md](./chat.md), 컨트롤러 직결(WebRTC)은
[controller-link.md](./controller-link.md), 세션 FSM·저장 정책은
[room-and-session.md](./room-and-session.md) 참고.
