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
- 장식 animation은 CSS keyframes로 정의하고 Tailwind animation token으로 노출한다.
  진입·퇴장·제스처는 `motion`이 맡는다 — 경계는 아래 [모션](#모션) 참고.
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

- **화면 프레임**: `Screen`(높이 정책 + safe-area) 하나와 그것을 감싼 `PlayBoard`(게임판) ·
  `ControllerScreen`(폰 컨트롤러). 화면에서 `min-h-dvh`·`h-svh` 껍데기를 새로 쓰지 않는다.
- **핵심 UI**: `canvas`, `surface`, `surface-raised`, `surface-sunken`, `border`,
  `border-raised`, `border-strong`, `surface-veil`, `content`,
  `content-muted`, `content-faint`, `focus`, `scrim`
- **상태**: `brand`, `brand-strong`, `on-brand`, `positive`, `warning`, `danger`
- **3D 물리 주사위 전용**: `physics-die`, `physics-pip`, `physics-accent`, `physics-danger`
- **랜딩 히어로 전용**(`landing-*`): 패널·카드·그림자·텍스트 등 랜딩 화면에서만 쓰는 별도
  네임스페이스. 본편 화면 색과 섞어 쓰지 않는다.
- **게임별 팔레트**(`pp-*` 탁구, `duel-*` 결투): 게임마다 세계관이 다르므로 네임스페이스를
  나눈다 — 서부극 결투가 요트 로비처럼 생기면 안 되고, 반대로 그 세계관 색이 전역 토큰을
  오염시켜도 안 된다. **단, 세계관과 무관한 것은 시스템 토큰을 가리킨다**: "주의·이김·짐"은
  앱 전체가 같은 말로 해야 하므로 `duel-gold`/`positive`/`danger`와 `pp-danger*`는
  `warning`/`positive`/`brand`/`brand-soft`를 가리킨다. 게임에서만 쓰는 색을 새로 만들 때는
  시스템 색과 충분히 떨어졌는지 확인한다 — RGB 거리 10~25면 나란히 놓아도 구분되지 않아
  팔레트가 아니라 실수가 된다.
- **소셜 로그인**: `kakao`, `kakao-ink` — 카카오 브랜드 색은 제공자 규정상 그대로 사용한다.
- **모션**: `ease-snappy`, 다양한 `animate-*`(턴 전환, 족보 콜아웃, 튜토리얼 가이드 등).
  지속시간은 `--ds-motion-*` 원시값과 `src/motion.ts`가 함께 보관한다
- **레이어**: `z-index-sticky`/`banner`/`sheet`/`modal`/`toast`

새 semantic token을 추가할 때는 `--ds-*` 원시 값을 먼저 정의하고 `@theme inline`에서
연결한다. 원시 색을 컴포넌트 class에 직접 넣지 않는다.

## 사다리(scale)

크기는 **정해진 단에서만 고른다.** 눈대중으로 px를 적으면 사다리가 아니라 연속값이 되고,
화면을 옮겨 다닐 때 "미묘하게 안 맞는" 느낌의 1순위 원인이 된다(S15P11A406-214에서 실제로
글자 20종·라운드 28종까지 벌어져 있었다).

### 글자

Tailwind 기본 사다리 + `text-2xs`(11px) 한 단이다. 11px은 한글 하한이라 그 아래 단은 만들지
않는다.

```text
2xs 11 · xs 12 · sm 14 · base 16 · lg 18 · xl 20 · 2xl 24 · 3xl 30 · 4xl 36 …
```

### 라운드

일곱 단 + `full`이다. 양 끝의 `chip`·`hero`는 그 사이가 필요할 때마다 화면에서 raw px를
적던 자리를 없애려고 채운 것이다.

```text
xs 2 · chip 6 · control 12 · card 14 · panel 18 · sheet 26 · hero 32 · full
```

`rounded-2xl`처럼 Tailwind 기본 라운드 이름은 쓰지 않는다 — 토큰과 값이 겹치거나 어긋난다.

### 간격

Tailwind 기본 spacing을 그대로 쓴다. 임의 값은 `clamp()`처럼 사다리로 표현할 수 없는 것에만
허용한다.

`env(safe-area-inset-*)`는 **더 이상 임의 값으로 쓰지 않는다.** 화면 위·아래 끝의 두 하한만
토큰이다 — `pt-safe-top`(위, `max(1rem, env(...))`) · `pb-safe-bottom`(아래, `max(1.25rem, env(...))`).
25곳이 각자 이 산술을 손으로 썼고 하한이 10종까지 벌어져 있었다. 그중 이 두 하한이 14곳이다.
남은 하한은 그 화면만의 값이라 임의 값으로 둔다.

위아래 하한이 다른 것은 의도다 — 아래는 홈 인디케이터 제스처 영역을 더 피한다.

### 화면 프레임

화면에서 `min-h-dvh`·`h-svh` 껍데기를 새로 쓰지 않는다. `Screen`이 높이 정책과 safe-area를
소유하고, `PlayBoard`(게임판)·`ControllerScreen`(폰 컨트롤러)이 그것을 감싼다.
`max-width`·배경은 props가 아니라 `className`으로 확장한다.

### 흰색 알파 헤어라인

반투명 흰색 경계는 **세 단**이다. 값으로 구별되므로 눈대중으로 `white/NN`을 적지 않는다.

```text
border(10%) · border-raised(14%) · border-strong(18%)
```

`border`는 기본 경계, `border-raised`는 떠 있는 표면(시트 상단·툴팁·칩·점선 빈자리)의 경계,
`border-strong`은 강조·선택 상태와 1px 구분선이다. 면으로 아주 옅게 깔 때는
`surface-veil`(6%)을 쓴다 — `surface`(#111214)는 불투명해서 뒤의 배경 그라디언트를 가린다.

랜딩의 `landing-hairline`·`landing-hairline-strong`은 **같은 원시값을 참조한다.** 헤어라인은
랜딩 팔레트가 아니라 앱과 공유하는 중성 사다리다(랜딩 밖 12곳이 같은 값을 썼다).

이 사다리에 없는 단이 필요하면 **이유를 주석에 적고** 임의 값을 쓴다 —
`Button`의 ghost 테두리(`white/28`)가 그 선례다(캔버스 위 대비 근거).

게임 화면(`duel/`·`pingpong/`)의 텍스트는 아직 `text-white/35`~`/85` 10단을 쓴다.
`content`/`content-muted`/`content-faint`를 흰색 알파로 다시 구현한 것이라 정리 대상이지만,
게임 캔버스 위 밝기 결정이 필요해 별도 티켓으로 둔다.

## 아이콘

화면 크롬 아이콘은 `shared/components/Icon.tsx` 하나로 모은다. 규약은 20×20 `viewBox`,
색은 `currentColor`, `aria-hidden` 고정, 크기는 호출부의 `className`이 정한다.

**이모지·문자 글리프를 쓰지 않는다.** 이모지는 `currentColor`를 따르지 않아 모노톤 화면에서
혼자 플랫폼 색으로 뜨고, 폭·베이스라인이 기기마다 달라 같은 줄의 줄바꿈까지 흔들리고,
글자라서 `size-*`로 크기를 통제할 수 없다. 예외는 **이모지가 곧 콘텐츠인 곳** 하나다
(리액션 픽커 — 사용자가 고르는 대상이 이모지 자체다).

## 모션

애니메이션 구현체가 둘이다. **어느 쪽을 쓸지는 취향이 아니라 아래 경계로 정해진다.**

| | CSS keyframes (`tokens.css`) | `motion` (`src/motion.ts`) |
|---|---|---|
| 담당 | **장식·상태 강조** — 요소가 이미 DOM에 있는 채로 반복하거나 한 번 튀는 것 | **진입·퇴장·제스처** — 요소가 나타나고 사라지는 것, 손가락을 따라가는 것 |
| 예 | `animate-ring-pulse`, `animate-turn-pop`, `animate-callout-*`, `animate-guide-bob`, `animate-spin-slow` | 바텀시트 슬라이드업, 모달·팝오버 pop, 스크림 페이드, 시트 드래그 |
| 이유 | 컴포지터에서 도는 순수 CSS다. JS 프레임을 쓰지 않으므로 물리 시뮬레이션이 도는 중에도 안전하다 | 언마운트를 붙잡아야 퇴장이 그려진다. CSS만으로는 `AnimatePresence`가 하는 일을 못 한다 |

**돌아가는 CSS 애니메이션을 motion으로 옮기지 마라.** 특히 주사위가 굴러가는 동안
같이 도는 것(`callout-*`, `ring-pulse`)은 JS 프레임을 한 줄도 더 쓰면 안 된다 —
`rapier` 스텝과 같은 프레임을 다투게 된다.

공통 규칙:

- 지속시간·이징 값은 `src/motion.ts`의 `DURATION`·`EASE_*`와 `tokens.css`의
  `--ds-motion-*`·`--ds-ease-snappy`가 **같은 값을 양쪽에 적어둔 것**이다. 한쪽만 고치지 않는다.
- 기준(ui-skills `animation-systems`): 마이크로 120–200ms · UI 상태 180–260ms ·
  팝오버 220–320ms · 섹션 진입 400–800ms.
- `transform`·`opacity`만 움직인다. `width`·`top`·`box-shadow`·`filter`는 보간하지 않는다.
- `motion-reduce`에서 개별적으로 중화한다. 전역 스위치 하나로 끄지 않는다.
- `m` + `LazyMotion`이 아니라 `motion.*`를 쓴다. provider 없이 렌더되는 경로가 있어
  `m`은 그때 애니메이션이 통째로 죽는다.
- jsdom에는 WAAPI가 없어 `AnimatePresence` 퇴장이 끝나지 않는다 —
  `src/test/setup.ts`가 이를 통과 컴포넌트로 mock한다. 테스트에서 motion이 소유한
  요소의 `transform`·`opacity`는 단정할 수 없다.

## 컴포넌트 규칙

1. 화면에서 HTML button을 새로 꾸미지 않고 공통 `Button`을 우선 사용한다.
   `Button`으로 표현할 수 없으면 **`Button`을 감싼 얇은 컴포넌트**를 만든다
   (선례: `GameChromeButton` — 게임 크롬 알약 버튼 7곳을 하나로).
   감싸는 쪽에 스타일을 쌓지 말고 공통 컴포넌트의 variant map에 추가한다.
2. variant class는 동적으로 문자열을 만들지 않고 정적 map에 기록한다.
3. 외부 배치는 `className`으로 확장한다. 내부 구조와 상태 표현은 컴포넌트가 소유한다.
4. 클릭 가능한 요소는 최소 `min-h-tap`을 지킨다.
5. focus ring, **pressed**, disabled, loading, error, reconnect 상태를 누락하지 않는다.
   pressed는 hover가 없는 터치에서 "닿았다"를 알리는 유일한 채널이다. 값은 한 곳에 있다 —
   `recipes.css`의 **`pressable`**(scale 0.97)을 쓰고 직접 `active:scale-*`를 적지 않는다.
   `Button`도 이 레시피를 쓴다. 예외는 두 가지다: 24px 이하 글리프는 3%가 보이지 않아
   `active:scale-90`을 직접 주고, 눌림을 빼는 자리(전체화면 스크림 · 제스처를 받는 조작면 ·
   점수표 칸 · 드래그 손잡이)는 왜 빼는지 그 자리에 적는다.
6. animation은 `motion-reduce`에서 제거하거나 최소화한다.
7. 임의 값은 safe-area, fluid typography처럼 token화가 부적합한 경우에만 사용한다.

## 검증

- Biome: Tailwind directive 파싱과 코드 규칙
- TypeScript strict: variant와 props 타입
- React Testing Library: 상태·접근성 interaction
- Vite production build: 실제 Tailwind class 생성
- Component catalog(`/__dev/components`): 모바일·데스크톱 viewport 시각 확인
