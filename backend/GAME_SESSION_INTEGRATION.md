# 게임 세션 프론트엔드·WebSocket 연동

## 현재 구현 범위

REST가 방 상태의 유일한 변경 경로입니다. Redis에는 방, 멤버, 점수, 게임 ID 매핑이 저장됩니다.

```text
room:{roomCode}          capacity, members, hostId, phase, gameId
room:{roomCode}:players  userId -> nickname
room:{roomCode}:scores   userId -> score (초기값 0)
game:{gameId}            roomCode
```

`phase`는 `LOBBY`, `PLAYING`, `FINISHED` 중 하나입니다. 방 생성자는 `hostId`이며 게임 시작 권한을 가집니다.

WebSocket 서버는 `/ws/v1/game`에 열려 있지만, **현재 구현된 메시지는 `sys.ping`/`sys.pong`뿐입니다.** `room.join`, `room.snapshot` broadcast는 다음 WebSocket 연결 관리 작업의 범위입니다. 구현되지 않은 room WebSocket 메시지를 지금 보내면 처리되지 않습니다.

## 프론트 REST 흐름

### 1. 게스트 생성

```http
POST /api/v1/users/guests
Content-Type: application/json

{"nickname":"yorr"}
```

```json
{"userId":"...","nickname":"yorr","sessionToken":"..."}
```

`userId`, `sessionToken`, `nickname`은 브라우저의 `sessionStorage`에 보관합니다. 게스트 세션은 인증된 요청이 없으면 24시간 후 Redis에서 자동 삭제됩니다.

```ts
const authHeaders = () => ({
  "X-User-Id": sessionStorage.getItem("userId")!,
  Authorization: `Bearer ${sessionStorage.getItem("sessionToken")!}`,
});
```

### 2. 방 생성 또는 참가

모든 상태 변경 요청에는 위 인증 헤더가 필요합니다.

| 목적 | 요청 | 응답 |
| --- | --- | --- |
| 방 생성 | `POST /api/v1/rooms?size=4` | `roomCode` 문자열 |
| 방 참가 | `POST /api/v1/rooms/{roomCode}/players` | `JoinResult` |
| 방 나가기 | `DELETE /api/v1/rooms/{roomCode}/players/me` | 204 |
| 방/대기실 조회 | `GET /api/v1/rooms/{roomCode}` 또는 `/lobby` | `RoomSnapshot` |
| 게임 시작 (host만) | `POST /api/v1/rooms/{roomCode}/games` | `gameId`, `RoomSnapshot` |
| 게임 상태 조회 | `GET /api/v1/games/{gameId}` | `RoomSnapshot` |

`JoinResult`는 아래 구조입니다.

```json
{
  "playerId": "게스트 userId",
  "sessionToken": "현재 sessionToken",
  "snapshot": {
    "roomCode": "ABC123",
    "gameId": null,
    "hostId": "...",
    "phase": "LOBBY",
    "capacity": 4,
    "players": [{"playerId":"...","nickname":"yorr","score":0}]
  }
}
```

화면에는 `playerId`가 아니라 `nickname`만 표시합니다. `playerId`는 상태 갱신과 본인 판별에만 사용합니다.

같은 게스트가 같은 방에 다시 참가하면 인원은 중복 증가하지 않고 최신 snapshot이 반환됩니다. 정원 검사는 서버 Redis Lua에서 원자적으로 수행하므로, 프론트의 사전 인원 확인은 UX 용도일 뿐 최종 판단이 아닙니다.

## 현재 WebSocket 사용

```ts
const socket = new WebSocket(`${wsBaseUrl}/ws/v1/game`);

socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === "sys.connected") {
    // heartbeatIntervalMs를 사용해 ping을 전송한다.
  }
  if (message.type === "sys.pong") {
    // 연결 유지 확인
  }
};

socket.send(JSON.stringify({ type: "sys.ping", ts: Date.now(), payload: {} }));
```

현재 WebSocket은 방에 참가시키거나 Redis 상태를 변경하지 않습니다. 방 생성·참가·나가기·시작은 반드시 REST API로 호출합니다.

## 다음 WebSocket 작업 계약

WebSocket 연결 관리자는 메모리에 `roomCode -> WebSocketSession들`만 관리합니다. 멤버십, 점수, phase는 Redis의 `RoomService`만 변경합니다.

브라우저 WebSocket은 커스텀 HTTP 헤더를 붙일 수 없으므로, 연결 직후 첫 메시지로 인증·구독을 보냅니다.

```json
{
  "type": "room.subscribe",
  "roomId": "ABC123",
  "payload": {
    "userId": "...",
    "sessionToken": "..."
  }
}
```

서버는 토큰을 검증하고 해당 WebSocket session만 방 구독 목록에 추가한 뒤 최신 상태를 보냅니다.

```json
{
  "type": "room.snapshot",
  "roomId": "ABC123",
  "payload": {
    "roomCode": "ABC123",
    "gameId": null,
    "hostId": "...",
    "phase": "LOBBY",
    "capacity": 4,
    "players": []
  }
}
```

REST로 참가·나가기·게임 시작이 성공한 직후, WebSocket 계층은 `RoomService.getSnapshot(roomCode)` 결과를 같은 `room.snapshot` 형식으로 해당 방 모든 구독자에게 broadcast합니다. 프론트는 `room.snapshot`을 받으면 로컬 방 상태 전체를 교체합니다.

재연결 시 프론트는 저장한 게스트 토큰으로 REST `POST /players`를 다시 호출해 최신 snapshot을 받고, 이어서 `room.subscribe`를 보냅니다. 기존 멤버라면 중복 입장하지 않습니다.

## 오류 처리

| 상태 | 의미 | 프론트 처리 |
| --- | --- | --- |
| 401 `invalid_guest_session` | 게스트 토큰 만료 또는 불일치 | 게스트 생성 화면으로 이동 |
| 403 `host_only` | 방장이 아닌 사용자의 게임 시작 | 시작 버튼 비활성화/안내 |
| 404 | 방 또는 게임이 없음 | 방 코드 입력 화면으로 이동 |
| 409 `room_full` | 정원 초과 | 대기실 입장 실패 안내 |
| 409 `game_started` / `game_not_ready` | 진행 중 입장 또는 시작 조건 미충족 | 최신 snapshot 재조회 후 안내 |
