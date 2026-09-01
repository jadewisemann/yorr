# 방과 세션 — 수명주기·FSM·복구·빠른 대전·파티 모드

> SSOT: [`../../src/room/domain/sessionFsm.ts`](../../src/room/domain/sessionFsm.ts),
> [`../../src/room/roomSessionStorage.ts`](../../src/room/roomSessionStorage.ts),
> [`../../src/room/api/roomApi.ts`](../../src/room/api/roomApi.ts), [`../../src/store.ts`](../../src/store.ts)

## 파일 지도

| 파일 | 책임 |
|---|---|
| `room/domain/sessionFsm.ts` | 세션 수명 FSM — phase를 `(roomSession, roomSnapshot)`에서 **파생** |
| `room/roomSessionStorage.ts` | localStorage 영속화 — `{session, expiresAt}` 봉투 + 런타임 검증 |
| `room/domain/roomCode.ts` | 초대 코드 정규화·검증, 붙여넣은 초대 URL에서 `?code=` 추출 |
| `room/partyControllerStorage.ts` | "이 방은 파티 모드다"의 폰 쪽 기억 (방 코드 단위) |
| `room/model/useControllerLinkRole.ts` | 이 기기가 컨트롤러 직결에서 맡을 역할 판정 (`dashboard`·`controller`·없음) |
| `room/connectSequence.ts` | 재연결·연결 단계 타이밍 상수 (실기기에서 함께 튜닝하는 값들) |
| `room/api/roomApi.ts` | 방 REST 계약 + 응답→도메인 변환 + `isRoomHost` |
| `room/api/quickMatchApi.ts` | 빠른 대전 대기열 REST (`POST/GET/DELETE /quick-matches`) |
| `room/components/QuickMatchOverlay.tsx` | 라우터 루트의 매칭 대기 백드롭 + 1초 polling |
| `room/components/InvitePopover.tsx` | 초대 말풍선 (QR + 코드 + 복사/공유) |
| `room/components/ControllerConnectSequence.tsx` | 파티 컨트롤러 연결 스텝퍼 + 게임별 사용법 슬롯 |
| `room/screens/*` | `NicknamePage` · `LobbyPage` · `GamePage`(게임 셸) · `RoomExitGuard` · `PartyDashboardPage` · `PartyOnBigScreenPage` |

## 세션 FSM (`sessionFsm.ts`)

```text
idle ──join 성공──▶ joining ──첫 snapshot──▶ inLobby ⇄ inGame ──▶ finished
  ▲                                                                │(재대결은 inGame으로)
  └────── leave 완료 · room.closed · 세션 만료 ──────────────────────┘
```

**상태는 저장하지 않고 파생한다** — store가 이미 들고 있는 `(roomSession, roomSnapshot)`에서
`sessionPhaseOf`로 계산한다. 별도 상태를 저장하면 두 소스가 어긋나는 순간 유령 세션이 생긴다.
다른 방의 스냅샷은 무시하고 `joining`으로 본다.

- `sessionScreenOf(phase)` — 상태↔URL 동기화 규칙이 이 한 곳에만 있다 (`home`/`lobby`/`game`)
- 종료 전이는 전부 `store.endSession(reason)` 한 곳으로 모은다.
  `SessionEndReason = left · room_closed · expired · disconnected · removed` — 이유마다
  사용자 안내 문구가 다르다 (`sessionEndNotices`).
- **`disconnected`만 비대칭이다**: 토큰을 지우지 않고 `roomResumeReason: 'disconnected'`로
  복귀 확인 상태에 멈춘다. 나머지 이유만 저장소를 지우고 idle로 끝난다.

## 세션 저장 (`roomSessionStorage.ts`)

- 키 `yorr.room-session`, TTL **40분** — 방 자체가 서버(Redis)에서 40분 TTL로 사라지므로
  수명을 방에 맞춘다. 더 오래 남기면 "이어서 하기 → 방 없음" 실패만 만든다.
- 저장할 때마다 만료를 갱신한다(sliding). 봉투 `{session, expiresAt}` — 만료는 저장소의
  관심사라 세션 계약에 섞지 않는다.
- 읽을 때 전체 필드 런타임 검증 + 만료분 즉시 폐기. 스냅샷의 `roomId`가 세션과 다르면 거부.
- **복원돼도 자동 입장하지 않는다.** 사용자가 "이어서 하기"를 명시적으로 고른 뒤에만 토큰을
  서버에 제시한다 (`roomResumeReason: 'restored'` 게이트 + 랜딩의 복귀 배너).
- 로그인 세션(`yorr.auth-session`, 30일)과 일부러 분리 — 방을 나가도 로그인은 남아야 한다.

## 방 수명주기

- **생성/참가는 같은 `POST /rooms`** — `room_id` 없으면 생성(host), 있으면 참가(participant).
  로그인 상태면 `session_token`을 함께 보내 결과를 계정에 귀속시키고, 없으면 서버가 새
  게스트를 만든다 (게스트 전용 로그인 엔드포인트는 없다).
- `roomId === roomCode` — 클라이언트 전역 불변식.
- **방장은 서버 상태다** (`isRoomHost`): 처음 들어온 사람이 방장이 되고, 방장이 나가면 남은
  사람이 이어받는다(승계). 입장 시점에 굳는 `membershipRole`로 판단하면 승계 후 거짓말이
  된다 — `state.sync`로 갱신되는 `snapshot.hostId`가 유일한 근거.
- **퇴장은 단일 경로** (`useLeaveSession`): 서버에 알린 뒤 로컬 세션을 정리하되, REST가
  실패해도 로컬은 반드시 정리한다 — 요청 실패가 사용자를 방에 가두는 이유가 될 수 없다.
  `RoomExitGuard`가 라우터 blocker로 확인 다이얼로그를 세운다 (로비⇄게임 이동은 막지 않음).
- 초대 코드는 `[A-Z0-9]{4,12}`. 초대 링크 통째 붙여넣기가 실제 주 진입 경로라,
  `sanitizeRoomCodeInput`이 URL에서 `?code=`만 추출한다 — 그냥 정규화하면
  `https://yorr.app/...`가 `HTTPSYORRAPP`이 되어 패턴을 통과해 버린다.
- 초대 UI는 인라인 카드에서 **말풍선 팝오버**로 이전 — 320×568에서 카드가
  세로를 다 먹어 참가자 목록이 4px로 짜부라졌다. 초대는 방 생성 직후 한 번 하는 조작이라
  항시 노출할 가치가 없다.
- **채팅은 그 반대 판정이다** — 대기실에서 대화는 계속하는 일이라 `ChatPanel`을 상주시킨다.
  대신 세로 압박을 초대 카드와 같은 방식으로 겪지 않도록 배치를 갈랐다: 대기실 본문(컨트롤러
  안내·봇 패널·참가 인원 줄·참가자 목록)은 **하나의 스크롤 영역**이고, 헤더·시작 버튼·채팅은
  그 밖에서 자리를 지킨다. 목록만 따로 굴리게 두면 채팅이 차지한 만큼 시작 버튼이 화면 밖으로
  밀려난다.
- 좁은 화면의 채팅 높이는 **고정**이다(`h-64`). 남는 높이를 본문과 나눠 갖게 두면 대화가
  쌓일수록 참가자 목록이 잠식된다. 넓은 화면(`lg`)에서만 오른쪽 열이 되어 화면 높이를 쓴다.

## 빠른 대전 (Quick Match)

REST 계약: `POST/GET/DELETE /quick-matches` (모두 회원 인증 필요),
`QuickMatchStatus = NOT_QUEUED · WAITING · MATCHED · PLAYING`, 조회 간격 1초.

핵심 설계:

- **백드롭은 라우터 루트에 한 번만 선다** (`QuickMatchOverlay`). 매칭이 잡히면 화면이
  닉네임 → 대기실로 옮겨 가는데, 그 뒤에도 `PLAYING`까지 조회를 이어가야 한다 — 이 조회가
  두 사용자의 소켓 연결을 확인하고 게임을 시작시킨다. 화면 안에 두면 이동하는 순간
  polling이 끊긴다. 대기 요청(`QuickMatchRequest`)도 같은 이유로 store에 둔다.
- **`MATCHED`에서 `POST /rooms`를 다시 부르지 않는다.** 서버가 이미 이 사용자를 방에 넣어
  뒀으므로 방 세션만 합성해 대기실로 이동하면 기존 `RealtimeSync`가 `room.join`을 보낸다.
  `membershipRole`은 `participant`로 두고 실제 방장 여부는 `hostId`로 판단한다.
- 취소가 서버에서 실패해도 로컬 대기는 반드시 끝낸다. `MATCHED` 후에는 취소가 성립하지
  않는다(이미 방 안). 대기가 끝나면 백드롭을 **즉시** 트리에서 뺀다 — 퇴장 연출을 기다리면
  opacity 0 스크림이 대기실 클릭을 먹는다.
- 게스트 토큰은 방 입장 시에만 발급되므로 빠른 대전은 현재 로그인 필수.

## 파티 모드

큰 화면(TV/모니터)이 게임판이 되고, 폰들이 QR로 붙어 컨트롤러가 되는 모드.

- **`dashboard` 역할**: `POST /rooms?party=true`(닉네임 없음)로 방을 열면 서버가 이 세션을
  플레이어 명단에 넣지 않는다. 대시보드는 호스트 권한 없이 게임을 비추기만 한다 —
  방장은 **처음 들어온 컨트롤러 폰**이고, 시작·봇 추가는 그 폰의 대기실에서 한다
  (TV에 마우스를 기대하지 않는 것과 같은 이유로 대시보드에는 조작 버튼이 없다).
- 대시보드 화면(`PartyDashboardPage`)은 랜딩 팔레트를 버리고 **게임 화면과 같은 골격**
  (`GamePlay`의 네 개 띠, 같은 트레이 클래스)을 쓴다 — 시작 순간에 팔레트나 골격이 바뀌면
  "이어지는 화면"이 될 수 없고, 트레이 크기가 같아야 WebGL 컨텍스트·물리 월드 재생성을
  구조적으로 피한다.
- 새로고침 시 기존 대시보드 세션을 이어 쓴다 — 새 방을 열면 QR이 바뀌어 이미 들어온
  사람들이 남의 방을 보게 된다.
- **폰이 컨트롤러임을 아는 방법**: 서버 스냅샷에 방 모드가 없어서, 대시보드가 초대 URL에
  `party=1`을 실어 보내고 입장 성공한 폰이 `yorr.party-room`에 **방 코드와 함께** 기억한다.
  플래그만 남기면 다음 일반 방까지 컨트롤러로 뜬다. 알려진 구멍: 초대 코드를 손으로 입력해
  들어온 사람은 일반 화면으로 뜬다 — 이 기억이 **컨트롤러 링크의 존재 조건**이기도 해서
  (`useControllerLinkRole`) 같은 구멍이 연출 하나를 더 건드린다
  ([controller-link.md](./controller-link.md) 「알려진 틈」).
- 좁은 화면의 `/party`는 대시보드를 억지로 그리지 않고 안내 화면으로 받는다 — 폰의
  대시보드는 덜 좋은 경험이 아니라 **틀린** 경험이다.

### 컨트롤러 직결 (WebRTC)

파티 모드에서는 폰과 대시보드가 **WebRTC DataChannel로 직접 이어진다.** 야추의 흔들림·던지기
같은 연출 릴레이만 그 길로 보내 서버 왕복 한 홉을 없애고, 서버가 판정하는 입력은 그대로
WebSocket으로 간다. 링크가 안 붙으면 전부 WebSocket으로 떨어진다 —
설계·판정표·폴백 규칙은 [controller-link.md](./controller-link.md).

**협상은 대시보드가 먼저 건다**: 서버가 대시보드를 플레이어 명단에 넣지 않으므로 폰은
대시보드의 playerId를 알 방법이 없고, 반대 방향은 스냅샷으로 알 수 있다. 시그널링은
`ctrl.signal` 유니캐스트를 쓰고 TURN은 붙이지 않는다(STUN만) — 중계를 타면 없애려던 서버
홉이 되살아난다.

### 컨트롤러 연결 시퀀스 (`ControllerConnectSequence`)

`connecting(최소 600ms) → connected(900ms 유지 + 40ms 진동) → ready(게임별 사용법)`.
타이밍 상수는 `connectSequence.ts` 한 파일에 모은다 — 재연결이 1초인데 단계 표시가
0.2초면 붙기도 전에 붙었다고 하는 화면이 된다.

게임별 사용법은 **슬롯 계약**이다: `controllerHowTo: Partial<Record<GameCode, ComponentType>>`
(현재 `DUEL`·`PING_PONG` 등록). 사용법 컴포넌트는 자기 게임 폴더에 두고 props를 받지
않는다 — `room/`은 게임을 모른다. 등록이 없는 게임도 기본 문구로 깨지지 않는다.
사용법은 `ready`에서만 편다 — 붙기 전에 "이렇게 흔드세요"부터 읽히면 연결이 고장난 줄 안다.

## 세션 복구 UX

- **복귀 배너**(`ActiveRoomBanner`, 랜딩): 참여 중인 방이 있을 때만 뜬다. 강제 리다이렉트
  대신 "돌아가기 / 이어서 하기 / 다시 연결"과 "나가기"를 사용자가 고른다. 목적지는 FSM
  (`sessionScreenOf`)이 정한다.
- **오프라인 표시**: `presence.update`로 해당 플레이어의 status만 패치. `PlayerCard`와
  게임 중 `TurnStrip`이 같은 "연결 끊김" 경고 필을 쓴다.
- 연결 상태 5종(`idle·connecting·connected·reconnecting·closed`)은 로비 헤더 점 표시,
  게임 중 `ConnectionBanner`(항상 렌더되는 live region — 영역과 내용이 같은 프레임에 오면
  스크린리더가 놓친다)로 노출한다.
- 재연결·스냅샷 병합의 프로토콜 측은 [realtime.md](./realtime.md) 참고.

## 불변식 요약 (LLM 체크리스트)

1. 세션 phase는 파생 상태 — 저장 금지
2. 종료 전이는 `endSession(reason)` 단일 경로, `disconnected`만 토큰 보존
3. 방장 판단은 `snapshot.hostId`, `membershipRole` 금지 (dashboard 판별만 예외)
4. `roomId === roomCode`
5. 진행 상태·phase의 권위자는 WS. REST(`GET /games/:id`)는 1회짜리 백필 —
   `preserveRealtimeGame`이 REST 응답으로 phase를 되돌리지 않는다 (game.over와의 레이스로
   결과 화면이 영영 안 뜨는 실측 버그가 근거)
6. 저장 TTL 40분 = 서버 방 TTL, 복원 시 자동 입장 금지
7. 퇴장은 네트워크 실패에 막히지 않는다
8. 컨트롤러 직결(WebRTC)에는 **서버가 판정하는 메시지를 태우지 않는다** —
   [controller-link.md](./controller-link.md)의 판정표가 목록의 정본
