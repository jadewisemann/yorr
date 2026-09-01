# 텍스트 채팅 (chat.*)

> 상위 원칙은 [DESIGN.md](../../DESIGN.md).
>
> 구현(Node): `ws/chat.ts`(다듬기·검사·방송·도배 한도) · `ws/handler.ts`(메시지
> 라우팅과 거절 코드 분기) · `ws/protocol.ts`(`CHAT_TEXT_MAX_LENGTH`).
>
> 이 자리에 있던 WebRTC 음성 시그널링(`voice.*`)을 텍스트
> 채팅으로 교체하며 새로 만든 계약이다. 전환 배경은 [PLANS.md](../../PLANS.md)
> 「음성 채팅 → 텍스트 채팅」 절.

## 서버의 역할 — 중계 하나

`chat.send` 한 줄을 검사해 방 전원에게 `chat.message`로 방송한다. 그것이 전부다.

**저장하지 않는다.** 방은 게임 한 판만 사는 수명이라, 이력을 두면 방 TTL·재접속
스냅샷·정원 계산이 모두 늘어난다. 늦게 들어온 사람에게 지난 대화를 보여 주는 값이
그 비용을 넘지 않는다고 판정했다 — 그래서 재접속·`state.sync`에도 대화가 실리지
않고, 각 클라이언트가 들어온 뒤의 말만 화면에 들고 있다(프론트
`realtime/chat/useRoomChat.ts`).

## WS 메시지

`room.join` 이후에만 유효하다(아니면 `NOT_IN_ROOM`).

| 방향 | type | payload | 동작 |
|---|---|---|---|
| C→S | `chat.send` | `{text}` | 다듬고 검사한 뒤 방 **전체**에 `chat.message` |
| S→C | `chat.message` | `{messageId, playerId, nickname, text, at}` | 방 전원에게. **보낸 사람도 받는다** |

보낸 사람이 자기 말을 되받는 것이 계약이다. 보낸 쪽이 화면에 먼저 그리고 방송을
무시하는 구조는 두 벌의 목록을 만들고, 서버가 정한 `messageId`·`at`이 있어야 모두가
같은 줄을 같은 순서로 본다.

`playerId`·`nickname`·`at`·`messageId`는 **서버가 채운다.** 클라이언트가 payload에
실어 보낸 값은 무시한다 — 믿으면 남을 사칭할 수 있다(`reaction.broadcast`와 같은
규칙). `nickname`을 함께 싣는 이유는 보낸 사람이 방을 떠난 뒤에도 그 말이 화면에
남아야 하는데, 명단에서 지워진 playerId로는 이름을 찾을 수 없기 때문이다.

## 거절 규칙 — 코드가 갈리는 기준

| 상황 | code | 왜 |
|---|---|---|
| payload가 객체가 아님 | `INVALID_MESSAGE` | 봉투 문제다 |
| 다듬은 뒤 빈 문자열, 문자열이 아닌 `text` | `INVALID_MESSAGE` | 보낼 내용이 없다 |
| `CHAT_TEXT_MAX_LENGTH`(200자) 초과 | `INVALID_MESSAGE` | **자르지 않는다** — 잘린 말이 나가면 보낸 사람은 자기가 무엇을 보냈는지 모른다 |
| 창 안 한도 초과 | `RATE_LIMITED` | 고칠 방법이 다르다: 글을 바꾸는 것과 잠시 기다리는 것 |

검사 순서는 다른 방 레벨 메시지와 같다(payload 검증 → 멤버십) — 방 밖에서 깨진
payload를 보내면 `NOT_IN_ROOM`이 아니라 `INVALID_MESSAGE`가 나간다.

## 도배 한도

`CHAT_RATE_LIMIT`(10줄) / `CHAT_RATE_WINDOW_MS`(10초), **playerId별**로 센다.
리액션과 달리 채팅은 글자가 화면에 쌓여서, 한도가 없으면 한 명이 대화를 덮어
버린다. 사람이 실제로 치는 속도(빠른 대화가 초당 한 줄 남짓)보다 넉넉해 정상 대화는
걸리지 않는다.

- **거절한 시도는 기록하지 않는다.** 세면 도배하는 쪽이 창을 계속 밀어 영구히
  막힌다.
- 소켓 종료·`room.leave`에서 기록을 버린다. **레지스트리에서 세션을 지우기 전**에
  불러야 한다(순서가 계약 — 지운 뒤에는 소켓만으로 누구였는지 알 수 없다).
- `RATE_LIMITED`가 실제로 전송되는 유일한 경로다. 그전까지 이 코드는 계약 목록에만
  있었다.

## 상태를 레지스트리에 두지 않는 이유

음성에는 방별 참가 명단(`joinVoice`/`leaveVoice`/`voiceMembersOf`)이 있었지만
채팅에는 명단이 없다 — 방에 있으면 대화에 있는 것이다. 서버가 들고 있는 유일한
상태는 도배 한도 기록이고, 그것은 방이 아니라 사람에 붙으므로 `ChatChannel` 안에
있다. 그래서 `RoomSessionRegistry`는 채팅을 모른다.

## 테스트

- `ws/__tests__/chat.test.ts` — 중계 규칙(다듬기·사칭 방지·길이·한도 창)과 핸들러
  거절 코드 분기.
- `ws/__tests__/gateway.test.ts` — 실제 소켓 위에서 방 전원(보낸 사람 포함)이 같은
  `messageId`를 받는 것과 빈 줄 거절.
