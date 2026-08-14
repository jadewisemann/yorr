# 방·세션

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `room/`, `user/`.
> 아래 키 스킴·흐름은 backend-java 기준이며 이식하며 검증·갱신한다.

## 게스트 세션

- `POST /api/v1/users/guests` {nickname} → {userId, nickname, sessionToken}
- 인증 헤더: `X-User-Id` + `Authorization: Bearer <sessionToken>`
- 게스트는 인증된 요청이 없으면 24시간 후 Redis에서 자동 삭제(TTL).

## Redis 키 스킴

```text
room:{roomCode}          capacity, members, hostId, phase, gameId
room:{roomCode}:players  userId -> nickname
room:{roomCode}:scores   userId -> score (초기값 0)
game:{gameId}            roomCode
game:{gameId}:scoreboard:{playerId}
                         category -> score, _upperSubtotal, _upperBonus, _total
game:{gameId}:score-submissions:{playerId}
                         roundNumber -> request signature
```

- 점수판은 미제출 카테고리 필드를 저장하지 않는다 — 값 `0`과 "아직 안 냄"을
  구분하기 위해서다.

## Phase 상태기계

`LOBBY → PLAYING → FINISHED`. 방 생성자가 `hostId`이며 게임 시작 권한을 가진다.

## 불변식

- **REST가 방 상태의 유일한 변경 경로다.** WS는 방 멤버십·phase를 바꾸지 않는다.
- **정원·중복 참가 판정은 Redis Lua에서 원자적으로.** 프론트의 사전 확인은 UX일
  뿐 최종 판단이 아니다. 같은 게스트의 재참가는 인원을 늘리지 않고 최신 snapshot을
  반환한다.
- **오래된 게임 매핑으로 현재 방 점수를 바꿀 수 없다.** 점수 갱신 Lua가 방 존재·
  현재 gameId·PLAYING 상태·참가자 여부를 같은 스크립트에서 먼저 검증한다.

## 오류 계약

| 상태 | 코드 | 의미 |
|---|---|---|
| 401 | `invalid_guest_session` | 토큰 만료·불일치 |
| 403 | `host_only` | 방장 아닌 사용자의 게임 시작 |
| 404 | — | 방·게임 없음 |
| 409 | `room_full` | 정원 초과 |
| 409 | `game_started` / `game_not_ready` | 진행 중 입장 / 시작 조건 미충족 |
