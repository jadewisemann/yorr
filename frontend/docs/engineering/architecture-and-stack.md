# 아키텍처와 기술 스택

> 기준일: 2026-08-01 — 실제 구현 기준(과거 "구현 전 검토안" 상태는 종료됨).
>
> 디렉터리 규칙의 SSOT는 [`../../CLAUDE.md`](../../CLAUDE.md)의 "디렉터리 구조" 절이다. 이 문서는
> 그 규칙이 왜 이런 형태인지, 실제로 무엇이 들어있는지를 설명한다.

## 디렉터리 구조 (`src/`)

`src/` 바로 아래는 **도메인**이다. 레이어는 도메인 안에 둔다.

| 폴더 | 책임 |
|---|---|
| `app/` | 라우터(`router.tsx`), 전역 provider, 앱 부팅. 개발 전용 화면은 `app/dev/`(`DevCatalog` · `MotionLab` · `PhysicsDiceDemo` · `HandVoiceLab`) |
| `landing/` | 랜딩 화면(`screens/EntryPage`), 히어로 카드·카루셀·진행 탭, 히어로 WebGL 장면(`rendering/heroScene.ts`) |
| `auth/` | 소셜 로그인 — `authSession`, `api/authApi`, `screens/AuthCallbackPage`, `components/AccountDialog` |
| `room/` | 방 생성·입장·로비와 **게임을 띄우는 껍데기**. `api/roomApi`(REST), `screens/GamePage`(phase로 게임 화면 선택), `screens/LobbyPage` · `NicknamePage` · `InvalidInvitePage` · `RoomExitGuard` |
| `yacht/` | 야추 구현 전부 — `domain/`(순수 규칙: `dice` · `scoring` · `specialHands` · `yachtGame`), `screens/`, `components/`(게임판 15개), `rendering/physics-dice/`(Three.js + Rapier), `input/`(DeviceMotion 제스처), `feedback/`(진동·효과음·족보 보이스) |
| `shared/` | 프리미티브 UI(`components/Button` · `Modal` · `BottomSheet` · `Popover` …), 공용 훅, `api/client`, `cn`, `soundtrack` |
| `realtime/` | WebSocket wire contract(`wsEvents.ts`, SSOT)와 연결 client(`realtimeClient.ts` · `fakeRealtimeClient.ts`) |
| `mocks/` · `test/` · `styles/` | MSW handler와 fixture, 테스트 하네스, 디자인 토큰 |
| `games.ts` · `store.ts` · `main.tsx` | 게임 카탈로그, 앱 전역 상태, 엔트리 |

### 왜 도메인 우선인가

이전 구조는 레이어 우선(`screens/` · `components/` · `api/` · `domain/`)이었다. 문제는 도메인이
레이어마다 흩어진다는 것이다 — 야추 하나를 이해하려면 `domain/` · `screens/` · `components/` ·
`rendering/` · `input/` · `feedback/` · `api/` 7개 폴더와 `src/` 루트(파일 19개가 산재)를 동시에
뒤져야 했다. `components/` 한 폴더에 랜딩 카드 7개와 야추 게임판 12개와 로비 패널 4개와 공용
버튼이 평평하게 섞여 있었다.

도메인 우선으로 두면 게임을 추가할 때 폴더 하나만 늘어난다.

### 테스트 배치

**테스트는 소스와 같은 폴더의 `__tests__/`** 에 둔다 — `yacht/domain/scoring.ts`의 테스트는
`yacht/domain/__tests__/scoring.test.ts`다. co-location을 쓰던 이전 구조에서는 `components/`를
열면 40여 개 파일 중 절반이 `*.test.tsx`라서 그 폴더에 무엇이 있는지 읽히지 않았다.

`vitest.config.ts`는 손대지 않았다 — `include: ['src/**/*.test.{ts,tsx}']` 글롭이 중첩된
`__tests__/`를 이미 잡고, vitest는 테스트 파일을 커버리지 분모에서 자동으로 뺀다.

### 게임을 추가할 때

손댈 곳은 세 군데다.

1. `src/games.ts`에 항목 추가 — 게임 카탈로그의 SSOT다. `live: false`면 랜딩에서 "준비 중"으로
   노출되고, `true`로 바꾸면 플레이 가능해진다. 현재 야추만 `live`이고 라이어스 다이스·정오의
   결투·탁구·낚시가 대기 중이다.
2. `src/<게임>/` 구현 — `yacht/`와 같은 모양.
3. `room/screens/GamePage`에서 키로 화면 분기 — 이 컴포넌트는 방 껍데기라서 야추 개념이 없고
   `roomSnapshot.phase`로 진행 화면과 결과 화면을 고르기만 한다. 게임이 갈라지는 지점이다.

## 의존 방향

사용자 흐름 순서로 **단방향**이다.

```text
app → landing → room → yacht
```

`auth` · `shared` · `realtime` · `games.ts` · `store.ts`는 경계 모듈이라 어느 도메인에서나
참조한다. 되돌아가는 import를 만들지 않는다. `yacht/domain/`은 React · DOM · 네트워크를 모르고,
`yacht/rendering/`은 `screens` · `realtime` · `store`를 import하지 않는다.

**레이어·도메인을 넘는 import만 `@/`를 쓴다.** 같은 폴더 안은 상대경로를 쓴다. 실제 파일 없이
미래를 위한 폴더를 만들지 않는다.

### 알려진 경계 예외 2건

둘 다 로직 변경이 필요해 구조 재편과 분리했다. 근거는 해당 파일 주석에 남겨 두었다.

- **`realtime/wsEvents.ts` → `yacht/domain/*`** — 와이어 계약 자체가 야추 모양이다. `dice.*`
  이벤트와 `round.submit`의 `YachtCategory`가 프로토콜에 박혀 있어서, `realtime/`을 `shared/`
  안에 넣으면 의존 방향이 역행한다. 그래서 도메인 위의 경계 계층으로 남겨 두었다. 게임을
  추가하려면 게임 무관 envelope와 게임별 payload로 갈라야 한다 — 백엔드는 `GameModule`로 이미
  분리했고 프론트 계약만 남았다. **게임 추가를 실제로 막고 있는 것은 폴더 구조가 아니라 이
  프로토콜이다.**
- **`yacht/screens/GameResult.tsx` → `room/api/useGameApi`** — 결과 화면이 "대기실로 돌아가기"를
  직접 호출한다. 부모인 `room/screens/GamePage`가 `onLeaveRequest`처럼 콜백으로 내려주면
  사라진다.

## 상태 설계

### 서버 권위 상태

- 방 phase와 host, 참가자 목록과 접속 상태
- 라운드 번호와 deadline, 현재 턴의 활성 플레이어
- 현재 주사위와 승인된 킵 상태, 굴림 횟수와 제출 여부
- 카테고리 점수와 총점

WebSocket 이벤트나 재접속 스냅샷만 이 상태를 변경한다. React 컴포넌트가 직접 수정하지 않는다.

### 로컬 UI 상태

- 화면에서 편집 중인 킵 마스크, 선택 중인 카테고리, 애니메이션과 모달
- 센서 권한·입력 모드, 연결 안내 UI

로컬 게임 입력 상태는 `gameId`/`roundId`에 귀속한다. 새 라운드나 재접속 스냅샷을 받으면 이전
draft, 애니메이션, pending 입력을 폐기한다.

### 파생 상태

남은 시간, 버튼 활성 여부, 예상 카테고리 점수, 모든 플레이어 완료 여부 표시는 서버 상태에서
계산하며 별도 원본으로 저장하지 않는다.

## 확정 기술 스택

| 분류 | 선택 |
|---|---|
| 런타임 | React 19, TanStack Router, Zustand |
| 빌드/타입 | Vite, TypeScript strict |
| 포맷/스타일 | Biome, Tailwind CSS v4(CSS-first `@theme`) |
| 3D/물리 | Three.js, `@dimforge/rapier3d-compat` |
| 기타 | `qrcode.react`(클라이언트 QR 생성), `clsx` + `tailwind-merge`(`cn()`) |
| 테스트 | Vitest, React Testing Library, MSW, Playwright |

### 검토 중 — 여전히 미채택

아래는 여전히 프로젝트에 도입되지 않았다(2026-08-01 기준 재확인, `package.json`과 `src/`
전체 import 기준 grep 결과 사용처 0곳).

- **TanStack Query**: REST가 명령형 호출 위주라 캐시 가치가 낮음. 조회·캐시 무효화가 늘면 도입.
- **Zod**: `wsEvents.ts`는 compile-time 타입만 제공. 외부 payload runtime 검증 담당처가
  정해지면 도입.
- **ts-pattern**: 현재 타입만으로 `switch` exhaustive 처리가 가능해 필수는 아님.
- **es-toolkit**: 반복 구현되는 유틸리티가 생기기 전까지 추가하지 않음.

## 테스트 전략

1. **순수 단위 테스트**: Yacht 점수, 카테고리 후보, timer 계산, event reducer. 네트워크 mock을
   사용하지 않는다.
2. **컴포넌트·통합 테스트**: Testing Library + MSW. 방 생성 실패, WS 연결 지연, 중복 이벤트,
   재접속 스냅샷을 검증한다.
3. **브라우저 E2E**: Playwright. 초대 URL부터 게임 완료까지 검증한다. WebSocket은
   `routeWebSocket` 또는 실제 테스트 서버(`test:e2e:real`)를 사용한다.
4. **실기기 smoke test**: 갤럭시 Chrome, iPhone Safari에서 센서 권한, 흔들기 감도, background
   복귀, 탭 fallback을 확인한다. `/__dev/motion`(`MotionLab`)이 실기기 센서 튜닝 용도로 배포
   환경에도 열려 있다.

검증 명령과 최소화 원칙은 [`../../CLAUDE.md`](../../CLAUDE.md)를 따른다.
