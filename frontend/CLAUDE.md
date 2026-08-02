# YORR Frontend — 에이전트 작업 지침

> Git 협업 규칙은 루트 [`../CLAUDE.md`](../CLAUDE.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md)를 그대로 따른다. 이 파일은 `frontend/` 안에서 작업할 때만 적용되는 내용을 다룬다.

## 문서 읽기 원칙

`frontend/docs/`는 위키처럼 인덱스 구조로 되어 있다. [`docs/index.md`](docs/index.md) 하나만
보고 표에서 필요한 파일만 골라 연다 — 읽는 방법과 문서 목록은 그 파일에만 적어두고 여기서
반복하지 않는다. 문서와 코드가 충돌하면 코드가 이긴다.

## 디렉터리 구조 (src)

레이어는 기본적으로 `src/` 바로 아래 **한 단계**에만 둔다. 레이어 안에 하위 폴더를 만들지
않는다 — 유일한 예외는 `src/rendering/physics-dice/`와 `src/rendering/hero/`처럼 하나의 public
API를 구성하는 강하게 결합된 subsystem이다.

- `src/app`: 라우터, 전역 provider, 앱 부팅, 개발 전용 화면(`DevCatalog`, `MotionLab`)
- `src/screens`: URL에 대응하는 화면(`EntryPage`, `NicknamePage`, `LobbyPage`, `GamePage`, `GamePlay`, `GameResult`, `AuthCallbackPage` 등)
- `src/components`: 재사용 UI 컴포넌트
- `src/api`: REST client(`client.ts`)와 호출 훅(`gameApi.ts` · `authApi.ts` · `use*Api.ts`)
- `src/realtime`: WebSocket wire contract(`wsEvents.ts`, SSOT)와 연결 client
- `src/domain`: 순수 Yacht 게임 규칙(`dice.ts` · `scoring.ts` · `yachtGame.ts`). React/DOM/네트워크를 모른다
- `src/feedback`: 진동·효과음·족보 콜아웃 등 플랫폼별 굴림 피드백
- `src/input`: `DeviceMotion` 기반 흔들기·던지기 제스처 인식
- `src/rendering`: 3D 물리 주사위(`rendering/physics-dice/`)와 랜딩 히어로 장면(`rendering/hero/`)
- `src/mocks`: MSW handler와 fixture
- `src/store.ts` · `src/cn.ts` · `src/styles/`: 전역 상태, class 병합, 디자인 토큰

**주의:** `src/core/{api,realtime}`와 `src/contracts/ws-events.ts`는 2026-07-23 무렵의 초안
스캐폴드가 정리되지 않고 남은 **죽은 코드**다. 어디서도 import되지 않는다 — 새 코드에서
참고하거나 의존하지 않는다. 삭제는 별도 코드 변경 티켓에서 처리한다.

규칙:

- **레이어를 넘는 import만 `@/`를 쓴다.** 같은 폴더 안은 상대경로를 쓴다 — `@/`가 보이면 레이어 경계라는 뜻이다.
- 파일 하나 = 개념 하나. 파일명만 훑어도 앱이 읽히도록 이름 짓는다.
- 의존 방향은 `app → screens → components · api · realtime · domain → store · cn`으로 유지한다. `domain`과 `rendering`은 서로, 그리고 `screens`·`realtime`·`store`를 import하지 않는다. 되돌아가는 import를 만들지 않는다.
- 실제 파일 없이 미래를 위한 폴더를 만들지 않는다. `features`, `entities`, `widgets`, `shared`는 추가하지 않는다.

자세한 설계 근거는 [`docs/engineering/architecture-and-stack.md`](docs/engineering/architecture-and-stack.md) 참고.

## 스타일·디자인 시스템

- Tailwind CSS v4와 CSS-first `@theme`를 사용한다.
- 색상·간격은 원시 값 대신 semantic token을 사용한다.
- 공통 class 병합은 `src/cn.ts`의 `cn()`을 사용한다.
- 공통 UI가 있으면 화면에서 같은 컴포넌트를 새로 만들지 않는다.
- 애니메이션 구현체가 둘이다. **장식·상태 강조(반복·한 번 튐)는 CSS keyframes,
  진입·퇴장·제스처는 `motion`**(`src/motion.ts`)이다. 경계와 이유는
  [`docs/engineering/design-system.md`](docs/engineering/design-system.md)의 「모션」에 있다 —
  돌아가는 CSS 애니메이션을 motion으로 옮기지 않는다.
- 디자인이 확정되지 않은 상태에서 pixel-perfect 작업을 임의로 확대하지 않는다.

## 검증 명령

```bash
npm run check
npm run typecheck
npm test
npm run build
npm run test:e2e
```

작업을 마치기 전 **작업 범위에 필요한 검증만** 실행한다. 모든 명령을 관성적으로 실행하지 않는다.

## 테스트 최소화 원칙

- 테스트는 명확한 회귀 위험이나 완료 조건이 있을 때만 작성·실행한다.
- Tailwind 설정, 디자인 토큰, 정적 스타일, 단순 마크업 변경은 기본적으로 `typecheck`와 `build`까지만 검증한다.
- React Testing Library는 사용자 interaction, 접근성 상태, 조건부 렌더링처럼 컴포넌트 동작을 보장해야 할 때만 사용한다.
- Playwright E2E는 실제 사용자 흐름, 다중 사용자 상태, 브라우저 호환성이 해당 티켓 범위에 명시된 경우에만 실행한다.
- 모바일 Chrome·Safari 테스트는 실기기·브라우저 검증 티켓 또는 사용자의 명시적 요청이 없으면 실행하지 않는다.
- 미래 요구를 예상한 테스트, 구현과 같은 내용을 반복하는 테스트, 단순 렌더링 확인용 테스트는 추가하지 않는다.
- 기존 테스트가 변경 범위와 직접 관련되면 해당 테스트만 우선 실행한다. 전체 테스트는 통합·배포 단계에서 실행한다.
- UI 변경의 시각 검토도 해당 티켓의 완료 조건일 때만 수행한다.

검증 개수를 작업 품질로 간주하지 않는다. 작업 위험과 완료 조건에 비례해 검증한다.
