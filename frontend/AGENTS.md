# YORR Frontend — 에이전트 작업 지침

> Git 협업 규칙은 루트 [`../AGENTS.md`](../AGENTS.md), [`../CLAUDE.md`](../CLAUDE.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md)를 그대로 따른다. 이 파일은 `frontend/` 안에서 작업할 때만 적용되는 내용을 다룬다.

## 터미널 실행

- 모든 터미널 명령은 사용자 프로필을 로드하지 않는 non-login shell로 실행한다.

## 문서 읽기 원칙

`frontend/docs/`는 위키처럼 인덱스 구조로 되어 있다. [`docs/index.md`](docs/index.md) 하나만
보고 표에서 필요한 파일만 골라 연다 — 읽는 방법과 문서 목록은 그 파일에만 적어두고 여기서
반복하지 않는다. 문서와 코드가 충돌하면 코드가 이긴다.

## 디렉터리 구조 (src)

`src/` 바로 아래는 **도메인**이다. 레이어(`screens` · `components` · `api` …)는 도메인 **안에**
둔다 — 레이어를 먼저 두면 야추 하나를 이해하려고 6개 폴더를 동시에 뒤져야 했다.

| 폴더 | 책임 |
|---|---|
| `app/` | 라우터, 전역 provider, 앱 부팅. 개발 전용 화면은 `app/dev/` |
| `landing/` | 랜딩 화면과 히어로 연출 |
| `auth/` | 소셜 로그인·세션 |
| `room/` | 방 생성·입장·로비, 그리고 게임을 띄우는 껍데기(`screens/GamePage`) |
| `yacht/` | 야추 구현 — 규칙·화면·게임판·주사위 물리·센서 입력·피드백 |
| `shared/` | 프리미티브 UI, 공용 훅, REST client, `cn` |
| `realtime/` | WebSocket wire contract(`wsEvents.ts`, SSOT)와 연결 client |
| `mocks/` · `test/` · `styles/` | MSW, 테스트 하네스, 디자인 토큰 |
| `games.ts` · `store.ts` · `main.tsx` | 게임 카탈로그, 앱 전역 상태, 엔트리 |

도메인 안에서는 필요한 레이어 폴더만 만든다(`yacht/domain/` · `yacht/screens/` ·
`yacht/rendering/physics-dice/` 등). 실제 파일 없이 미래를 위한 폴더를 만들지 않는다.

**테스트는 소스와 같은 폴더의 `__tests__/`** 에 둔다 — `yacht/domain/scoring.ts`의 테스트는
`yacht/domain/__tests__/scoring.test.ts`다. 폴더를 열었을 때 소스만 보여야 읽힌다.

규칙:

- **도메인·레이어를 넘는 import만 `@/`를 쓴다.** 같은 폴더 안은 상대경로를 쓴다 — `@/`가 보이면 경계라는 뜻이다.
- 파일 하나 = 개념 하나. 파일명만 훑어도 앱이 읽히도록 이름 짓는다. 폴더가 이미 말해 주는 것을 파일명에 반복하지 않는다.
- 의존 방향은 사용자 흐름 순서로 **단방향**이다: `app → landing → room → yacht`. `auth` · `shared` · `realtime` · `games.ts` · `store.ts`는 경계 모듈이라 어느 도메인에서나 참조한다. 되돌아가는 import를 만들지 않는다.
- `yacht/domain/`은 React·DOM·네트워크를 모른다. `yacht/rendering/`은 `screens`·`realtime`·`store`를 import하지 않는다.

**알려진 경계 예외 2건**(둘 다 로직 변경이 필요해 별도 티켓이다. 근거는 해당 파일 주석에 있다):

- `realtime/wsEvents.ts` → `yacht/domain/*` — 와이어 계약 자체가 야추 모양이다(`dice.*`, `round.submit`의 `YachtCategory`). 게임을 추가하려면 게임 무관 envelope와 게임별 payload로 갈라야 한다.
- `yacht/screens/GameResult.tsx` → `room/api/useGameApi` — 결과 화면이 "대기실로 돌아가기"를 직접 호출한다. `GamePage`가 콜백으로 내려주면 사라진다.

**게임을 추가할 때** 손댈 곳은 세 군데다: `src/games.ts`에 항목 추가 → `src/<게임>/` 구현 →
`room/screens/GamePage`에서 키로 화면 분기.

자세한 설계 근거는 [`docs/wiki/architecture.md`](docs/wiki/architecture.md) 참고.

## 스타일·디자인 시스템

- Tailwind CSS v4와 CSS-first `@theme`를 사용한다.
- 색상·간격은 원시 값 대신 semantic token을 사용한다.
- 공통 class 병합은 `src/shared/cn.ts`의 `cn()`을 사용한다.
- 공통 UI가 있으면 화면에서 같은 컴포넌트를 새로 만들지 않는다.
- 애니메이션 구현체가 둘이다. **장식·상태 강조(반복·한 번 튐)는 CSS keyframes,
  진입·퇴장·제스처는 `motion`**(`src/shared/motion.ts`)이다. 경계와 이유는
  [`docs/wiki/design-system.md`](docs/wiki/design-system.md)의 「모션」에 있다 —
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
