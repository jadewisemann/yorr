# YORR 프론트엔드 디자인 시스템

> 기준일: 2026-07-22  
> 관련 Jira: [S15P11A406-63](https://ssafy.atlassian.net/browse/S15P11A406-63)

## 기술 기준

- Tailwind CSS v4와 공식 Vite 플러그인을 사용한다.
- JavaScript 설정 대신 CSS-first `@theme`를 사용한다.
- 색상 이름은 실제 색상이 아니라 UI 역할을 나타내는 semantic token으로 정의한다.
- 공통 컴포넌트의 variant는 정적 class map으로 관리한다.
- 조건부 class와 호출자가 전달한 class는 `cn()`으로 병합한다.
- 복잡한 animation은 CSS keyframes로 정의하고 Tailwind animation token으로 노출한다.

## 파일 구조

```text
frontend/src/shared/
  cn.ts                        # clsx + tailwind-merge
  styles/global.css            # Tailwind import, reset, 전역 접근성 정책
  styles/tokens.css            # semantic token과 animation token
  ui/*.tsx                     # 재사용 공통 컴포넌트

frontend/src/features/catalog/
  ComponentCatalogPage.tsx     # 개발 전용 컴포넌트 카탈로그
```

개발 서버에서 `/__dev/components`로 카탈로그를 확인한다.

## Token 계층

### 원시 값

`--ds-*` 변수는 현재 브랜드 값을 보관한다.

```css
--ds-color-canvas: #172033;
--ds-color-brand: #f7cb55;
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

## Semantic color

| Token | 용도 |
|---|---|
| `canvas` | 앱 최하위 배경 |
| `surface` | 카드·패널 배경 |
| `surface-raised` | 선택·강조된 표면 |
| `border` | 기본 경계선 |
| `content` | 기본 텍스트 |
| `content-muted` | 보조 텍스트 |
| `brand` | 핵심 행동과 선택 |
| `brand-strong` | brand 강조·hover |
| `on-brand` | brand 배경 위 콘텐츠 |
| `positive` | 성공 상태 |
| `danger` | 오류·위험 상태 |
| `focus` | 키보드 focus ring |

## 컴포넌트 규칙

1. 화면에서 HTML button을 새로 꾸미지 않고 공통 `Button`을 우선 사용한다.
2. variant class는 동적으로 문자열을 만들지 않고 정적 map에 기록한다.
3. 외부 배치는 `className`으로 확장한다. 내부 구조와 상태 표현은 컴포넌트가 소유한다.
4. 클릭 가능한 요소는 최소 `min-h-tap`을 지킨다.
5. focus ring, disabled, loading, error, reconnect 상태를 누락하지 않는다.
6. animation은 `motion-reduce`에서 제거하거나 최소화한다.
7. 임의 값은 safe-area, fluid typography처럼 token화가 부적합한 경우에만 사용한다.

## 공통 컴포넌트

- `Button`: primary, secondary, ghost와 sm, md, lg 크기
- `Dice`: sm, md, lg와 held, rolling 상태
- `Modal`: Escape, backdrop, 초기 focus 처리
- `PlayerCard`: host, ready, playing, disconnected 상태
- `ScoreRow`: 선택, 비활성, 표시 전용 상태
- `StatusPanel`: loading, empty, error, reconnect 상태

## 검증

- Biome: Tailwind directive 파싱과 코드 규칙
- TypeScript strict: variant와 props 타입
- React Testing Library: 상태·접근성 interaction
- Vite production build: 실제 Tailwind class 생성
- Component catalog: 모바일·데스크톱 viewport 시각 확인
