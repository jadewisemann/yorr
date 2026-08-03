# 실시간·API 계약

> 기준일: 2026-08-01 — [`../../src/realtime/wsEvents.ts`](../../src/realtime/wsEvents.ts)와
> `src/*/api/*.ts`를 직접 읽고 정리했다. 필드·이벤트 이름이 이 문서와 충돌하면 코드가 이긴다.

## 통신 구조

- REST base path: `/api/v1`(`API_BASE_URL`, 기본값. `VITE_API_BASE_URL`로 재정의 가능)
- WebSocket: WSS. 방·게임 상태와 점수 판정은 서버 권위.
- 인증 REST 호출은 `Authorization: Bearer <sessionToken>`과 `X-User-Id` 헤더를 사용한다.

## WebSocket Envelope

```json
{
  "type": "room.join",
  "ts": 1753000000000,
  "payload": {},
  "roomId": "room_abc123",
  "msgId": "c-001"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | string | 메시지 판별자 |
| `ts` | epoch ms | 아웃바운드는 서버가 채움 |
| `payload` | object | 이벤트별 데이터 |
| `roomId` | string? | 입장 이후 방 스코프 |
| `msgId` | string? | ack·상관관계. 클라이언트 값을 서버가 echo |

인증은 별도 `auth.*` 네임스페이스 없이 `room.join`의 payload(`roomId`, `nickname`,
`sessionToken`)에 통합되어 있다.

## 실제 이벤트 목록

### 연결

- C→S `sys.ping`, `sys.reconnect`
- S→C `sys.pong`, `sys.connected`, `sys.disconnect`, `sys.reconnected`

### 방

- C→S `room.join`, `room.leave`, `room.ready`
- S→C `room.joined`, `room.player_joined`, `room.player_left`, `room.ready_changed`, `room.closed`

### 반응·현재 상태(state)

- C→S `reaction.send`
- S→C `reaction.broadcast`, `state.sync`(방 전체 상태를 diff 없이 통째로 보냄 — 2~6인 규모라
  diff 비용이 필요 없다는 판단), `presence.update`, `state.patch`(정의되어 있으나 현재 미사용)

### 음성 채팅 (🟡 제안 — 구현 없음, S15P11A406-130)

- C→S `voice.join`, `voice.leave`, `voice.signal`(`{to, data}` — 서버가 `from`을 채워 전달)
- S→C `voice.peers`(음성 채널 전체 명단. 증분 아님), `voice.signaled`(`{from, data}`)

WebRTC **풀메시**다. 오디오는 피어끼리 직접 흐르고 서버는 시그널링만 중계한다 — `voice.signal`의
`data`(SDP·ICE)를 서버가 파싱하지 않는 것이 계약이다. offer 충돌은 `playerId`가 작은 쪽이
offer를 만드는 규칙으로 피한다. ICE/TURN 설정은 이 계약에 없다(필요해지면 REST로 분리).

### 라운드·주사위·점수

- C→S `round.submit`, `dice.roll`, `dice.hold`(굴림 중 KEEP 토글 동기화), `dice.shake`(흔드는
  강도·방향 relay), `dice.throw`(던지기 타이밍 relay)
- S→C `round.start`, `round.end`, `dice.broadcast`, `dice.hold_changed`, `dice.shaken`,
  `dice.thrown`, `score.update`, `game.over`

`dice.shake`/`dice.shaken`과 `dice.throw`/`dice.thrown`은 관전 중인(현재 턴이 아닌) 참가자가
활성 플레이어의 물리적 굴림 동작을 실시간으로 보게 하기 위한 이벤트다 — 사발이 실제로 기울기
전에 결과가 먼저 보이는 것을 막는다.

`chat.*`와 `match.matched`는 존재하지 않는다. 채팅 네임스페이스 자체가 없다.

### 공통 오류

```json
{
  "type": "error",
  "ts": 1753000000000,
  "payload": {
    "code": "ROOM_FULL",
    "message": "방 정원이 가득 찼습니다.",
    "refMsgId": "c-001"
  }
}
```

오류 코드: `AUTH_REQUIRED`, `AUTH_FAILED`, `SESSION_EXPIRED`, `ROOM_NOT_FOUND`, `ROOM_FULL`,
`NOT_IN_ROOM`, `ALREADY_IN_ROOM`, `GAME_ALREADY_STARTED`, `INVALID_MESSAGE`, `RATE_LIMITED`,
`INTERNAL`, **`NOT_YOUR_TURN`**(현재 턴이 아닌 참가자의 굴림·제출 요청 거절).

## REST API — 프론트가 실제로 호출하는 엔드포인트

`src/room/api/roomApi.ts`, `src/auth/api/authApi.ts` 기준.

| 메서드 | 경로 | 용도 |
|---|---|---|
| `POST` | `/rooms` | 방 생성(`room_id` 없이) 또는 참가(`room_id` 포함). 로그인 상태면 `session_token`을 함께 보내 결과를 계정에 귀속시킨다 |
| `GET` | `/games/{gameId}` | 방/게임 스냅샷 조회 |
| `POST` | `/rooms/{roomCode}/games` | 게임 시작(host 전용, `Authorization`/`X-User-Id` 필요) |
| `POST` | `/rooms/{roomCode}/lobby` | 종료된 게임을 대기실로 되돌림(재대결, host 전용) |
| `POST` | `/games/{gameId}/score-candidates` | 현재 주사위의 카테고리별 점수 후보 조회 |
| `DELETE` | `/rooms/{roomCode}/players/me` | 방 나가기 |
| `GET` | `/auth/kakao/authorize` | 카카오 로그인 시작(전체 페이지 리다이렉트) |
| `GET` | `/auth/google/authorize` | 구글 로그인 시작(전체 페이지 리다이렉트) |
| `POST` | `/auth/session` | 소셜 로그인 콜백 code를 세션으로 교환 |
| `GET` | `/auth/me` | 로그인 세션 검증·갱신 |
| `DELETE` | `/auth/session` | 로그아웃 |
| `PATCH` | `/users/me` | 닉네임(프로필) 변경 |

방 생성/참가 응답(`RoomSession`): `id`(→`you`), `nickname`, `token`(→`sessionToken`),
`room_id`(→`roomId`/`roomCode`). `membershipRole`은 서버가 내려주는 값이 아니라 **어느 REST를
호출했는지로 프론트가 스스로 붙이는 라벨**이다(`createRoom` → `host`, `joinRoom` →
`participant`). 서버가 역할을 직접 내려주지 않는 한 이 라벨은 클라이언트 신뢰 값이라는 점을
염두에 둔다.

`/games/{gameId}` 응답의 `game` 필드(진행 상태)는 있으면 참고하되 없거나 형태가 달라도 무시한다
— 진행 상태의 실제 SSOT는 WebSocket(`state.sync`, `round.start`)이다.

## 도메인 모델 (요약)

```ts
interface Player {
  playerId: string
  nickname: string
  status: 'online' | 'away' | 'offline'
}

interface RoomSnapshot {
  roomId: string
  phase: 'waiting' | 'playing' | 'finished'
  players: Player[]
  game?: GameState
}

interface GameState {
  activePlayerId: string
  roundNumber: number
  roundDeadline: number
  scores: Record<PlayerId, ScoreBoard>
}
```

정확한 타입과 필드는 [`../../src/realtime/wsEvents.ts`](../../src/realtime/wsEvents.ts)를
직접 확인한다 — 이 문서는 개요일 뿐이다.

## 백엔드 계약 확인 시 주의

이 문서는 **프론트가 실제로 호출/수신하는 것**을 기준으로 작성했다. 백엔드가 실제로 무엇을
구현했는지는 이 저장소 밖(Spring 백엔드 저장소)에서 확인해야 한다 — 프론트 문서에 백엔드
OpenAPI 스냅샷을 보관하면 둘 중 하나가 갱신될 때마다 어긋나므로, 프론트 저장소에는 프론트
관찰 기준만 남긴다.
