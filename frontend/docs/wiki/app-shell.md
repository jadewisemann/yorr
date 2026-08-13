# 앱 셸 — 부팅·라우터·전역 구성

> SSOT: [`../../src/app/router.tsx`](../../src/app/router.tsx), [`../../src/app/App.tsx`](../../src/app/App.tsx),
> [`../../src/main.tsx`](../../src/main.tsx)

## 부팅 순서

```text
main.tsx bootstrap()
  └─ enableMocking()      # DEV에서 MSW worker (VITE_ENABLE_MSW ≠ 'false')
  └─ #boot-splash 제거    # index.html 인라인 스플래시
  └─ render <App/>
       useAuthSessionCheck()          # 저장된 로그인 세션을 서버에 1회 검증
       <InAppBrowserGate>             # 카톡/인스타/네이버 웹뷰 안내 (그냥 진행 가능)
         <RealtimeSync client=...>    # 소켓 수명 + 서버 메시지 리듀서, RealtimeClientProvider 제공
           <VoiceProvider>            # 라우터 밖 — 화면 전환에도 통화 유지
             <RouterProvider router/>
```

`realtimeClient`는 렌더가 아니라 **모듈 스코프**에서 한 번 결정된다 —
`resolveMswMode() === 'mock'`이면 `createRealtimeFixture()`(가짜 소켓), 아니면
`WebSocketRealtimeClient`. fallback 모드는 실서버가 떠 있는 게 전제라 WS도 실서버에 붙는다.

MSW 모드(`mocks/mswMode.ts`): `mock`(DEV 기본, 전부 mock) · `fallback`(실서버 우선, 미처리
요청만 mock) · `off`(prod 고정).

## 라우트 표

| 경로 | 화면 | 비고 |
|---|---|---|
| `/` | `landing/EntryPage` | 초기 청크에 포함 (lazy 아님). `?game=` = 캐러셀 시작 칸 |
| `/tutorial` | `yacht/TutorialPage` | 연습 모드 — 방·세션 불필요 |
| `/leverage` | `yacht/LeveragePage` | 레버리지 다이스 로컬 변형 |
| `/pingpong` | `pingpong/PingPongModePage` | AI 탁구 (로컬) |
| `/auth/callback` | `auth/AuthCallbackPage` | 소셜 로그인 복귀 (`code`/`error`) |
| `/join` | `room/NicknamePage` 또는 `InvalidInvitePage` | `code`는 정규화 후 검증, `party=1`·`mode=quick`은 조건부 키 |
| `/party` | ≥760px `PartyDashboardPage`, 미만 `PartyOnBigScreenPage` | 파티 모드 큰 화면 |
| `/rooms/$roomId/lobby` | `room/LobbyPage` | |
| `/rooms/$roomId/game` | `room/GamePage` | 게임 셸 — gameCode로 화면 분기 |
| `/__dev/components` | `DevCatalog` | DEV 게이트 |
| `/__dev/controller` | `ControllerLab` | DEV 게이트 — 1인 가짜 서버로 컨트롤러 UI 단독 구동 |
| `/__dev/motion` | `MotionLab` | **DEV 게이트 없음** — 배포에서 실기기 센서 튜닝용 |
| 그 외 | `NotFoundPage` | |

검색 파라미터 불변식: 선택 키는 `undefined`/`false`로 선언하지 않고 **조건부 spread**로만
넣는다 — 항상 존재하는 키는 타입상 필수가 되어 `/`·`/join`으로 navigate하는 모든 화면이
그 값을 넘겨야 한다.

## 코드 스플리팅과 화면 전환

- **랜딩과 404만 초기 청크에 남긴다.** 링크·QR로 처음 들어온 사람이 랜딩 한 장을 보려고
  GamePlay·주사위 트레이·점수시트까지 전부 내려받고 있었다 — 첫 화면 지연의 최대 원인.
- `useScreenPrefetch()`가 첫 화면 이후 `requestIdleCallback`으로 나머지 청크를 미리 받는다.
  받아두지 않으면 화면 이동마다 전면 스피너가 한두 프레임 스쳐 전환이 깜빡인다.
- **화면 전환은 브라우저 View Transitions가 그린다** (`defaultViewTransition: true` +
  `global.css`의 `screen-pop-out/push-in`, 260ms). JS로 두 화면을 겹치는 방식은 이 라우터에서
  성립하지 않는다 — 나가는 화면을 붙잡으면 그 안의 `<Outlet/>`이 새 라우터 상태를 다시 읽어
  새 화면을 그리고, WebGL 컨텍스트·rapier 월드가 두 벌 살아난다. View Transitions는 옛 화면을
  **비트맵 스냅샷**으로 잡아 이 문제가 구조적으로 없다.
- `QuickMatchOverlay`는 라우터 루트(`ScreenTransition`)에서 `<Outlet/>` **밖**에 한 번만
  선다 — 매칭 대기는 닉네임 화면에서 시작해 대기실까지 이어지므로, 화면에 매달면 이동하는
  순간 polling이 끊긴다.

## 개발 전용 화면 (`app/dev/`)

| 화면 | 용도 |
|---|---|
| `DevCatalog` | 공통 컴포넌트 카탈로그 (+`PhysicsDiceDemo`, `HandVoiceLab` 내장) |
| `ControllerLab` | 파티 컨트롤러를 백엔드·대시보드·폰 없이 굴려보는 화면 — 연습 모드의 1인 가짜 서버(`yacht/domain/tutorialGame`)를 꽂아 굴리기·킵·족보 연출이 전부 진짜로 돈다 |
| `MotionLab` | 센서 튜닝 콘솔 — 실시간 임계값·차트·이벤트 로그·**녹화/재생**(`motionLabReplay`: 녹화한 센서 스트림을 다른 설정으로 결정론적으로 재판정) |

`MotionLab`만 DEV 게이트가 없다 — 센서 판정은 실기기에서만 튜닝할 수 있어 배포 환경에도
열어 둔다.

관련: 실시간 리듀서·재접속은 [realtime.md](./realtime.md), 세션 FSM은
[room-and-session.md](./room-and-session.md).
