# YORR Frontend — 에이전트 작업 지침

> Git 협업 규칙은 루트 [`../CLAUDE.md`](../CLAUDE.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md)를 그대로 따른다. 이 파일은 `frontend/` 안에서 작업할 때만 적용되는 내용을 다룬다.

## 문서 읽기 원칙 — 인덱스 하나로 바로 필요한 것만

`frontend/docs/`에는 기획·요구사항·아키텍처·API 계약 문서가 있다. 인덱스는
[`docs/README.md`](docs/README.md) **하나뿐**이다 — 폴더별 하위 인덱스는 없다.

1. [`docs/README.md`](docs/README.md)의 표를 보고 필요한 파일만 연다. 관련 없는 문서는 열지 않는다.
2. "지금 뭘 기준으로 만드나"류 질문이면 대부분 [`docs/current-baseline.md`](docs/current-baseline.md)
   한 파일로 충분하다 — 다른 문서를 열기 전에 먼저 확인한다.
3. `product/` · `engineering/` · `api/` · `process/` 폴더는 파일을 주제별로 묶어둔 것일 뿐,
   그 자체로 열어야 할 인덱스가 아니다 — 어떤 파일이 있는지는 `docs/README.md` 표로 판단한다.
4. 문서와 코드가 충돌하면 코드가 이긴다: WebSocket 타입은 [`src/realtime/wsEvents.ts`](src/realtime/wsEvents.ts)가 SSOT, Git 규칙은 루트 `CONTRIBUTING.md`가 SSOT다.

## 디렉터리 구조 (src)

레이어는 전부 `src/` 바로 아래 **한 단계**에만 둔다. 레이어 안에 하위 폴더를 만들지 않는다.

- `src/app`: 라우터, 전역 provider, 앱 부팅, 개발 전용 화면(`DevCatalog`)
- `src/screens`: URL에 대응하는 화면 (`EntryPage`, 이후 `LobbyPage` · `GamePage` · `ResultPage`)
- `src/components`: 재사용 UI 컴포넌트
- `src/api`: REST client(`client.ts` · `gameApi.ts`)와 호출 훅(`use*Api.ts`)
- `src/realtime`: WebSocket wire contract(`wsEvents.ts`)와 연결 client
- `src/mocks`: MSW handler와 fixture
- `src/store.ts` · `src/cn.ts` · `src/styles/`: 전역 상태, class 병합, 디자인 토큰

규칙:

- **레이어를 넘는 import만 `@/`를 쓴다.** 같은 폴더 안은 상대경로를 쓴다 — `@/`가 보이면 레이어 경계라는 뜻이다.
- 파일 하나 = 개념 하나. 파일명만 훑어도 앱이 읽히도록 이름 짓는다.
- 의존 방향은 `app → screens → components · api · realtime → store · cn`으로 유지한다. 되돌아가는 import를 만들지 않는다.
- 실제 파일 없이 미래를 위한 폴더를 만들지 않는다. `features`, `entities`, `widgets`, `core`, `shared`는 추가하지 않는다. 순수 게임 규칙 파일이 실제로 생기면 그때 `src/domain/`을 만든다.

자세한 설계 근거는 [`docs/engineering/architecture-and-stack.md`](docs/engineering/architecture-and-stack.md) 참고.

## 스타일·디자인 시스템

- Tailwind CSS v4와 CSS-first `@theme`를 사용한다.
- 색상·간격은 원시 값 대신 semantic token을 사용한다.
- 공통 class 병합은 `src/cn.ts`의 `cn()`을 사용한다.
- 공통 UI가 있으면 화면에서 같은 컴포넌트를 새로 만들지 않는다.
- 복잡한 animation만 CSS keyframes로 분리한다.
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
