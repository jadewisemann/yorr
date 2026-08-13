# 현재 적용 기준

> 기준일: 2026-08-01
>
> 이 문서는 각 주제의 **가장 최신 상태만** 반영한다. 문서와 코드가 다르면 코드가 이긴다 — 특히
> WebSocket 계약은 [`../src/realtime/wsEvents.ts`](../src/realtime/wsEvents.ts)가 SSOT다.

## 제품 범위

- 모바일 웹 기반 센서 요트다이스 게임. 2~6인 실시간 멀티플레이.
- 갤럭시 Chrome과 iPhone Safari 지원. 링크·QR·코드로 빠른 입장.
- 계정 없이 닉네임만으로 참가 가능(게스트). 카카오 로그인으로 계정을 연결할 수도 있다 —
  로그인 상태로 입장하면 그 판의 결과가 계정에 남고, 게스트로 입장하면 주인 없는 기록이 된다.
- 방 하나 = 초대 코드/QR 참가 + 요트다이스 고정. **모드 선택(파티/온라인/빠른 대전), 게임 종류
  선택 화면은 존재하지 않는다.** 초기 기획에 있던 이원화 구조는 폐기되었다.
- 서버가 지정한 순서대로 한 명씩 진행하는 **턴제** 라운드. 턴 시작과 각 굴림 완료마다 타이머가
  새로 시작된다(동시 진행 라운드 구조는 채택되지 않았다).
- 굴리는 중이 아닌 참가자는 활성 플레이어의 흔들기·던지기 동작을 실시간으로 함께 지켜본다
  (`dice.shake`/`dice.throw` 계열 이벤트). 관전은 초기 기획에서 "MVP 제외"였지만 지금은
  턴제 라운드의 핵심 연출로 구현되어 있다.
- 센서 실패·권한 거부 시 탭 조작으로 완주 가능.

## 방 역할

- 방을 만든 사람이 `host`, 참가한 사람이 `participant`다(`RoomMembershipRole`,
  [`../src/room/api/roomApi.ts`](../src/room/api/roomApi.ts)).
- 게임 시작과 종료 후 "대기실로 복귀(재대결)"는 `host`만 요청할 수 있다
  (`LobbyPage.tsx`, `GameResult.tsx`가 `membershipRole === 'host'`로 버튼을 막는다).
- 과거 기획 문서에 있던 "방장 역할을 두지 않는다"는 결정은 폐기되었다 — 현재 코드와 반대다.

## 계정·로그인

- 카카오 로그인은 전체 페이지 리다이렉트 방식이다: `GET /auth/kakao/authorize` →
  카카오 인증 → `/auth/callback?code=...` → `POST /auth/session`으로 code를 세션으로 교환.
- 로그인 세션은 `localStorage`에 30일 슬라이딩 TTL로 저장하며, 방 세션(`sessionStorage`)과는
  별도로 관리한다([`../src/auth/authSession.ts`](../src/auth/authSession.ts)).
- 닉네임은 프로필에서 변경할 수 있다(`PATCH /users/me`). 과거 게임 기록은 당시 닉네임을 그대로
  유지한다.
- 로그인 여부와 무관하게 방 참가 시 표시 닉네임 정책은 아래 "닉네임 정책"을 따른다.

## 프론트엔드 기술 기준

- React 19 + Vite + TypeScript strict, 모바일 웹 SPA. HTTPS/WSS 필수.
- 라우팅: TanStack Router. 상태: Zustand. 포맷: Biome. 스타일: Tailwind CSS v4(CSS-first
  `@theme`, 확정 사용 — 검토 단계 아님).
- 모션: `motion`(구 Framer Motion)이 진입·퇴장·제스처를, CSS keyframes가 장식·상태 강조를
  맡는다. 경계는 [`engineering/design-system.md`](./engineering/design-system.md)의 「모션」이
  기준이다.
- 3D 물리 주사위: Three.js + `@dimforge/rapier3d-compat`(`src/yacht/rendering/physics-dice/`).
- QR: `qrcode.react`로 클라이언트에서 직접 생성(외부 이미지 API 미사용).
- 센서: `DeviceMotion`/`DeviceOrientation`으로 흔들기·던지기 제스처를 판정
  (`src/yacht/input/`). 고빈도 원시 센서값은 전송하지 않고 판정된 게임 이벤트만 서버로 보낸다.
- Android: `navigator.vibrate` 진동 피드백. iOS: 센서 권한은 사용자 제스처 안에서
  `requestPermission()` 호출, 진동 미지원은 효과음·화면 흔들림·플래시로 대체
  (`src/yacht/feedback/`).
- 자세한 디렉터리 구조·의존성 목록은
  [`engineering/architecture-and-stack.md`](./engineering/architecture-and-stack.md) 참고.

## 실시간 통신

- 게임 데이터는 WebSocket(WSS)을 사용한다. **게임 데이터에 WebRTC는 쓰지 않는다** — 서버가
  상태의 권위자여야 하므로 P2P로 흘릴 수 없다.
- **음성 채팅(S15P11A406-130)만 WebRTC 풀메시를 쓴다.** 오디오는 피어끼리 직접 흐르고,
  서로를 찾는 시그널링(`voice.*`)은 위의 같은 WebSocket을 탄다. 미디어 서버(SFU)는 두지
  않는다 — 정원이 6명이라 필요 없다. 계약은 🟡 PROPOSED 상태이며 구현은 아직 없다.
- 서버가 방·라운드·점수 상태의 권위자(authoritative server)다.
- 실제 이벤트 목록·에러 코드·REST 엔드포인트는
  [`api/realtime-and-api.md`](./api/realtime-and-api.md) 참고. SSOT는
  [`../src/realtime/wsEvents.ts`](../src/realtime/wsEvents.ts)다.

## 실제 라우트(화면)

| 경로 | 화면 | 설명 |
|---|---|---|
| `/` | `EntryPage` | 시작 화면, 방 만들기/코드 참가 |
| `/join?code=` | `NicknamePage` 또는 `InvalidInvitePage` | 초대 코드/QR 진입, 닉네임 입력 |
| `/auth/callback` | `AuthCallbackPage` | 카카오 로그인 콜백 처리 |
| `/rooms/$roomId/lobby` | `LobbyPage` | 대기실, 참가자 목록, host 시작 버튼, 초대 QR/링크 |
| `/rooms/$roomId/game` | `GamePage` → `GamePlay`/`GameResult` | 라운드 진행, 결과·재대결 |
| `/__dev/components` | `DevCatalog` | 개발 전용 컴포넌트 카탈로그 |
| `/__dev/motion` | `MotionLab` | 실기기 센서 튜닝 페이지(배포 환경에도 존재, DEV 게이트 없음) |

## 닉네임 정책

> 2026-07-23 결정, 코드와 일치 확인됨(`src/room/screens/NicknamePage.tsx`).

- 닉네임은 사용자 식별자가 아닌 화면 표시용 값이다. 같은 방에서도 중복을 허용하며, 실제 식별은
  서버가 발급한 `playerId`/`sessionToken`을 사용한다.
- NFC 정규화 후 1~12자의 문자·숫자·공백만 허용한다. 빈 입력은 화면 진입 시 만든 추천 닉네임을
  그대로 사용할 수 있다.
- 입장에 성공한 세션은 `sessionStorage`에만 저장한다 — 새로고침·같은 탭 복구는 지원하되
  브라우저 종료 이후까지 남기지 않는다.

## 프론트엔드 안전장치

- 센서 권한 거부·미지원·값 미수신: 탭-투-롤로 대체.
- 던지기 제스처 미인식: 화면의 명시적 확정 버튼 제공.
- 무음·진동 미지원: 비주얼 피드백 유지.
- 인앱 웹뷰 오탐: "그냥 진행" 제공.
- 중복/역순 요청: `msgId` 기반으로 서버 응답과 정합성 회복.
- 서버 상태와 불일치: 서버 스냅샷을 기준으로 클라이언트 상태 교정.
- WebSocket 오류 코드에 `NOT_YOUR_TURN`이 추가되었다 — 턴이 아닌 참가자의 굴림·제출 요청을
  서버가 거절한다.

## 알려진 이슈

- 경계 규칙 예외 2건 — `realtime/wsEvents.ts`가 `yacht/domain/*`을, `yacht/screens/GameResult.tsx`가
  `room/api/useGameApi`를 import한다. 근거와 해소 방법은
  [`engineering/architecture-and-stack.md`](engineering/architecture-and-stack.md)의
  「알려진 경계 예외 2건」에 있다.
- 단위 테스트가 부하 상태에서 간헐적으로 실패한다(`GamePlay`·`GamePage`·`RoomExitGuard`
  ·`qrEntrance`, 그리고 `physics-dice/World.test.ts`가 47개를 통째로 skip하기도 한다).
  단독 실행하면 전부 통과한다 — S15P11A406-172. skip이 나면 커버리지 수치도 같이 떨어져
  임계값 미달로 보이므로, 커버리지를 판단할 때는 테스트 100 파일 823개가 다 돌았는지 먼저 본다.

## 미확정 사항

- 방 코드 만료 시각과 진행 중 난입/관전(외부 관전자용) 정책.
- 최소 인원 미달 시 게임 중단 이벤트 필요 여부.
- 12개 정규 카테고리 유지가 기본이고 8개 초스피드 모드는 후속 검토(현재 코드는 12개만 구현).
