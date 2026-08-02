# 디자인 시스템

> 기준일: 2026-08-01. 정확한 토큰 값과 전체 목록의 SSOT는
> [`../../src/styles/tokens.css`](../../src/styles/tokens.css)다 — 이 문서는 구조와 원칙만
> 설명한다. semantic token은 계속 추가되므로 여기서 전체 목록을 나열하지 않는다.

## 기술 기준

- Tailwind CSS v4와 공식 Vite 플러그인을 사용한다.
- JavaScript 설정 대신 CSS-first `@theme`를 사용한다.
- 색상 이름은 실제 색상이 아니라 UI 역할을 나타내는 semantic token으로 정의한다.
- 공통 컴포넌트의 variant는 정적 class map으로 관리한다.
- 조건부 class와 호출자가 전달한 class는 `cn()`으로 병합한다.
- 복잡한 animation은 CSS keyframes로 정의하고 Tailwind animation token으로 노출한다.
- 현재 단일 다크 테마다(라이트/다크 토글 없음, `:root`에 고정 팔레트).

## 파일 구조

```text
frontend/src/
  cn.ts                        # clsx + tailwind-merge
  styles/global.css            # Tailwind import, reset, 전역 접근성 정책
  styles/tokens.css            # semantic token과 animation token
  components/*.tsx             # 재사용 공통 컴포넌트
  app/DevCatalog.tsx           # 개발 전용 컴포넌트 카탈로그
```

개발 서버에서 `/__dev/components`로 카탈로그를 확인한다.

## Token 계층

### 원시 값

`--ds-*` 변수가 현재 브랜드 값을 보관한다.

```css
--ds-color-canvas: #08090a;
--ds-color-brand: #e53935;
--ds-size-tap: 2.75rem;
```

디자인 확정 또는 테마 추가 시 이 계층을 변경한다.

### Tailwind semantic token

`@theme inline`이 원시 값을 utility에 연결한다.

```css
--color-canvas: var(--ds-color-canvas);
--color-brand: var(--ds-color-brand);
--spacing-tap: var(--ds-size-tap);
```

컴포넌트는 `bg-[#172033]` 같은 원시 색상 대신 `bg-canvas`, `bg-brand`, `min-h-tap`을 사용한다.

## Semantic 그룹(개요)

전체 목록은 `tokens.css`를 확인한다. 큰 그룹만 요약하면:

- **핵심 UI**: `canvas`, `surface`, `surface-raised`, `surface-sunken`, `border`, `content`,
  `content-muted`, `content-faint`, `focus`, `scrim`
- **상태**: `brand`, `brand-strong`, `on-brand`, `positive`, `warning`, `danger`
- **3D 물리 주사위 전용**: `physics-die`, `physics-pip`, `physics-accent`, `physics-danger`
- **랜딩 히어로 전용**(`landing-*`): 패널·카드·그림자·텍스트 등 랜딩 화면에서만 쓰는 별도
  네임스페이스. 본편 화면 색과 섞어 쓰지 않는다.
- **소셜 로그인**: `kakao`, `kakao-ink` — 카카오 브랜드 색은 제공자 규정상 그대로 사용한다.
- **모션**: `duration-fast`/`base`/`roll`, `ease-snappy`, 다양한 `animate-*`(턴 전환, 족보
  콜아웃, 튜토리얼 가이드 등)
- **레이어**: `z-index-sticky`/`banner`/`sheet`/`modal`/`toast`

새 semantic token을 추가할 때는 `--ds-*` 원시 값을 먼저 정의하고 `@theme inline`에서
연결한다. 원시 색을 컴포넌트 class에 직접 넣지 않는다.

## 컴포넌트 규칙

1. 화면에서 HTML button을 새로 꾸미지 않고 공통 `Button`을 우선 사용한다.
2. variant class는 동적으로 문자열을 만들지 않고 정적 map에 기록한다.
3. 외부 배치는 `className`으로 확장한다. 내부 구조와 상태 표현은 컴포넌트가 소유한다.
4. 클릭 가능한 요소는 최소 `min-h-tap`을 지킨다.
5. focus ring, disabled, loading, error, reconnect 상태를 누락하지 않는다.
6. animation은 `motion-reduce`에서 제거하거나 최소화한다.
7. 임의 값은 safe-area, fluid typography처럼 token화가 부적합한 경우에만 사용한다.

## 검증

- Biome: Tailwind directive 파싱과 코드 규칙
- TypeScript strict: variant와 props 타입
- React Testing Library: 상태·접근성 interaction
- Vite production build: 실제 Tailwind class 생성
- Component catalog(`/__dev/components`): 모바일·데스크톱 viewport 시각 확인
