# 아키텍처와 기술 스택

> 기준일: 2026-08-01 — 실제 구현 기준(과거 "구현 전 검토안" 상태는 종료됨).
>
> 디렉터리 규칙의 SSOT는 [`../../CLAUDE.md`](../../CLAUDE.md)의 "디렉터리 구조" 절이다. 이 문서는
> 그 규칙이 왜 이런 형태인지, 실제로 무엇이 들어있는지를 설명한다.

## 디렉터리 구조 (`src/`)

레이어는 기본적으로 `src/` 바로 아래 한 단계에만 둔다.

| 폴더 | 책임 |
|---|---|
| `app/` | 라우터(`router.tsx`), 전역 provider, 앱 부팅, 개발 전용 화면(`DevCatalog`, `MotionLab`) |
| `screens/` | URL에 대응하는 화면(`EntryPage`, `NicknamePage`, `LobbyPage`, `GamePage`, `GamePlay`, `GameResult`, `AuthCallbackPage` 등) |
| `components/` | 재사용 UI 컴포넌트 |
| `api/` | REST client(`client.ts`)와 도메인별 호출 훅(`gameApi.ts`, `authApi.ts`, `useRoomApi.ts`, `useGameApi.ts`) |
| `realtime/` | WebSocket wire contract(`wsEvents.ts`, SSOT)와 연결 client(`realtimeClient.ts`, `fakeRealtimeClient.ts`) |
| `domain/` | 순수 Yacht 게임 규칙 — `dice.ts`(굴림 계획), `scoring.ts`(점수 계산), `specialHands.ts`, `yachtGame.ts`(상태 전이). React/DOM/네트워크를 모른다 |
| `feedback/` | 플랫폼별 굴림 피드백(진동·효과음·족보 콜아웃 보이스) — `RollFeedback.ts`, `createRollFeedback.ts`, `handVoice.ts` |
| `input/` | `DeviceMotion` 기반 흔들기·던지기 제스처 인식 — `MotionInputController.ts`, `MotionGestureRecognizer.ts`, `RollIntent.ts` |
| `rendering/` | 브라우저 렌더링 인프라. 일반 렌더링 파일은 이 폴더 한 단계에 두되, 하나의 public API를 구성하는 강하게 결합된 subsystem은 예외적으로 하위 폴더를 허용한다: `rendering/physics-dice/`(Three.js + Rapier 3D 주사위 시뮬레이션, 14개 파일)와 `rendering/hero/`(랜딩 히어로 WebGL 장면) |
| `mocks/` | MSW handler와 fixture |
| `store.ts` · `cn.ts` · `styles/` | 전역 상태, class 병합, 디자인 토큰(`styles/global.css`, `styles/tokens.css`) |

### 알려진 이슈 — 사용하지 않는 디렉터리

`src/core/{api,realtime}`와 `src/contracts/ws-events.ts`가 존재하지만 **어디서도 import되지
않는다**(`@/realtime/wsEvents`는 23개 파일에서 사용, `@/core`·`@/contracts`는 0곳). Git 히스토리상
`src/core/api/client.ts`는 2026-07-23 이후 수정이 없어, 초기 스캐폴드가 `src/api` + `src/realtime`
+ `src/domain` 구조로 대체된 뒤 삭제되지 않고 남은 것으로 보인다. `src/contracts/ws-events.ts`는
`src/realtime/wsEvents.ts`의 오래된 사본이며 `reaction.*`/`presence.*`/`dice.shake`/`dice.throw`가
빠져 있고 실제와 다른 `isHost`/`hostId` 필드가 남아 있다. **새 코드에서 참고하거나 의존하지
않는다.** 삭제는 이 문서 정리와 별개의 코드 변경으로 처리한다.

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

## 의존 방향

```text
app → screens → components · api · realtime → store · cn
domain은 React, DOM, 네트워크, rendering을 import하지 않는다.
rendering은 domain · screens · components · realtime · store를 import하지 않는다.
```

**레이어를 넘는 import만 `@/`를 쓴다.** 같은 폴더 안은 상대경로를 쓴다. 실제 파일 없이 미래를
위한 폴더를 만들지 않는다 — `features`, `entities`, `widgets`, `shared`는 추가하지 않는다.
`core`는 위 "알려진 이슈"에 남은 죽은 코드일 뿐 규칙의 예외가 아니다.

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
