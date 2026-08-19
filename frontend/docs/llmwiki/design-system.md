# 디자인 시스템 — 토큰·레시피·모션 경계

> SSOT: [`../../src/styles/tokens.css`](../../src/styles/tokens.css) (토큰 값 전체),
> [`../../src/styles/recipes.css`](../../src/styles/recipes.css), [`../../src/shared/cn.ts`](../../src/shared/cn.ts)

## 기술 기준

Tailwind CSS v4, CSS-first `@theme`. **다크가 기본이고 라이트가 오버라이드**다
(`:root` = 다크, `[data-theme="light"]`가 갈려야 하는 원시값만 덮는다).
`@import "tailwindcss" source("../")`로 class 탐지를 `src/`에 고정 — 자동 탐지는
`dist/` 같은 부산물까지 스캔해 빌드마다 CSS 크기가 달라진다.

**테마가 성립하는 이유가 `@theme inline`이다.** `inline`이 아니면 utility가 빌드 시점에
값으로 굳어 런타임에 원시값을 바꿔도 아무 일이 없다. `inline`이라 `bg-canvas`가
`background-color: var(--ds-color-canvas)`로 컴파일되고, 선택자 하나로 화면 전체가
따라온다. **이 2계층이 저장소의 제일 큰 자산이고, 컴포넌트는 테마를 모른다.**

라이트에서 덮는 것: 표면 5단 · 헤어라인 3단 + ghost · 면 3단 · 글자 3단 · focus ·
inverse 쌍 · brand의 위아래 단 · 상태색 3종 · 그림자 2종.
**안 덮는 것(의도)**: 게임 팔레트(`pp-*`·`duel-*`)와 랜딩(`landing-*`) — 세계관이
다르다, 탁구 코트는 라이트에서도 어두운 무대다. 주사위(`physics-*`) — 실물이라
테마와 무관하다. 스크림 — 뒤를 가리는 일은 양쪽 모두 검정이 한다. `brand` 자체 —
두 테마에서 같은 레드다.

**민 `brand`는 글자에 쓰지 않는다** — 라이트 canvas 위 3.54:1로 본문 기준 미달이다.
글자는 `brand-strong`(강조 낱말·배지, 다크 6.08/라이트 4.71) 또는 `brand-soft`(현재
턴 이름처럼 레드 틴트 배경 위). 예외 두 곳(NotFoundPage 로고 R · DuelHowTo)의 근거는
그 자리 주석과 `tokens.css` 라이트 블록에 있다.

## 2계층 토큰

1. **원시값** `:root`의 `--ds-*` — 브랜드 팔레트·크기·radius·그림자·이징·z-scale.
   디자인/테마가 바뀔 때 여기만 바꾼다. (`canvas #08090a`, `brand #e53935`,
   `tap 2.75rem`, motion 120/220/520ms, z 10/20/40/50/60 …)
2. **semantic 토큰** `@theme inline` — 각 항목이 `--ds-*`를 alias해 utility를 생성한다.
   컴포넌트는 `bg-[#…]` 대신 `bg-canvas` `bg-brand` `min-h-tap`을 쓴다.

네임스페이스: 핵심 UI(`canvas`/`surface`군/`content`군/`border`군/`focus`/`scrim`) ·
상태(`brand`군/`positive`/`warning`/`danger`) · 물리 주사위(`physics-*` — 단 3D 재질 색은
utility 없이 `appearance.ts`가 원시값을 직접 읽는다) · 랜딩 전용(`landing-*` — 본편 색과
섞지 않는다) · **게임별 팔레트**(`pp-*` 탁구, `duel-*` 결투 — 게임마다 세계관이 다르므로
네임스페이스를 나누되, "주의·이김·짐"처럼 세계관과 무관한 것은 시스템 토큰을 가리킨다.
게임 전용 색을 새로 만들 때는 시스템 색과 RGB 거리가 충분한지 확인한다) · 카카오 브랜드.

## JS가 색을 읽을 때 — 원시값만 읽는다

3D 재질·canvas 2D는 CSS를 거치지 않아 JS가 토큰을 읽어야 한다. 규칙 하나:
**`--ds-color-*`(원시값)를 읽는다. `--color-*`(semantic)를 읽지 않는다.**

`@theme inline`은 semantic 변수를 **항상 내보내지 않는다.** 그 색이 어딘가에서 알파
수식자와 함께 쓰일 때만(`bg-danger/20` 식) `--color-danger: var(--ds-color-danger)`가
CSS에 나오고, 수식자 없이만 쓰이는 색은 utility에 인라인돼 변수가 아예 없다
(실측: `--color-danger`·`--color-brand`는 있고 `--color-canvas`·`--color-content`는
빈 값이다). 즉 **semantic 변수의 존재 여부가 다른 파일의 `/20` 하나에 달려 있다** —
그것이 사라지면 읽던 쪽이 조용히 fallback으로 떨어진다. 원시값은 `:root`에 늘 있다.

`shared`의 `dsColorReader()`(`styles/tokenFallbacks.ts`)가 이 규칙을 **타입으로**
강제한다 — 인자가 `DS_COLOR_FALLBACK`의 키로 제한되고, `tokenFallbacks.test.ts`가
그 키 집합을 `--ds-color-physics-*` 전체와 정확히 일치시킨다(렌더러가 쓰는 색을
빠뜨리면 실패). 그래서 **3D는 physics 토큰만 읽을 수 있고**, physics는 테마를 타지
않으므로 테마 전환 시 3D를 다시 읽을 일이 없다. 게임 무대와 주사위가 라이트에서도
그대로인 것은 이 구조의 결과다.

## 사다리(scale) — 크기는 정해진 단에서만

눈대중 px는 "미묘하게 안 맞는" 느낌의 1순위 원인이다(실측: 글자 20종·라운드 28종까지
벌어져 있었다).

- **글자**: Tailwind 기본 + `text-2xs`(11px) 한 단. 11px은 한글 하한 — 그 아래 단은 없다.
- **라운드**: `xs 2 · chip 6 · control 12 · card 14 · panel 18 · sheet 26 · hero 32 · full`
  7단+full. `rounded-2xl` 같은 Tailwind 기본 라운드 이름은 쓰지 않는다 — 토큰과 겹치거나
  어긋난다.
  - **`card`와 `panel`은 크기가 아니라 모양으로 갈린다.** 표면 27곳을 세어 보니 panel 13 :
    card 14로 반반이었는데, card 14곳 중 10곳이 사방 패딩 없이 `px`/`py`만 쓰는 **행·띠**였고
    panel 13곳은 전부 `p-*`를 두른 **상자**였다. 이 갈래를 규칙으로 굳힌다 — 가로로 긴 행은
    `card`, 사방이 닫힌 덩어리는 `panel`. 상자는 `Panel`이 이미 `panel`을 들고 있으므로
    라운드를 손으로 적지 않는다.
- **흰색 알파 면(veil) 3단**: `surface-veil`(6%, 캔버스 위 칩·배너·카드 바닥) ·
  `surface-veil-raised`(14%, 눌림 상태·강조 점) · `surface-veil-strong`(24%, 시트
  손잡이처럼 확실히 보여야 하는 것). hairline 3단과 이름 규칙이 같다.
  `surface`(#111214)는 불투명해서 뒤 그라디언트를 가리므로 이 자리에 못 쓴다.
  - **`w-px` 같은 1px 선은 면이 아니라 선**이다 — veil이 아니라 `bg-border-strong`으로
    간다(선례: `PingPongModePage`의 듀오 모드 세로 분할선이 `bg-white/20`이었다).
- **흰색 알파 헤어라인 3단**: `border`(10%) · `border-raised`(14%, 떠 있는 표면) ·
  `border-strong`(18%, 강조·1px 구분선). 면으로 옅게 깔 때는 `surface-veil`(6%) —
  `surface`는 불투명해서 뒤 그라디언트를 가린다. 눈대중 `white/NN` 금지, 사다리에 없는
  단이 필요하면 이유를 주석에 적는다. **다만 raw 값은 테마를 따라가지 못한다** —
  Button ghost의 `white/28`이 그 예로, 라이트에서 흰 배경에 흰 테두리라 버튼 윤곽이
  통째로 사라졌다. 사다리 밖이어도 **토큰이어야 한다**(`border-ghost`, 용도로 갈리므로
  3단에는 안 끼운다).
  - **사다리 밖 값은 가장 가까운 단으로, 동점이면 낮은 단으로 간다** — `gap`의 "동점이면
    좁은 쪽"과 같은 처방이다. 헤어라인은 올리면 UI가 시끄러워지고 되돌릴 때도 낮춘 쪽이
    쉽다. (이 규칙으로 옮긴 내역: `15→14` 8곳 · `12→10` 5곳 · `20·22→18` 5곳 ·
    `8→10` 2곳 · `18` 1곳은 일치)
- **스크림 3단**: `scrim-soft`(45%) · `scrim`(66%) · `scrim-strong`(72%). 갈리는 기준은
  진하기가 아니라 **역할**이다 — `soft`는 `backdrop-blur`와 함께 쓰는 얕은 막이거나 3D
  캔버스 위에서 글자를 읽히게 하는 판(뒤를 가리는 게 목적이 아니다), `scrim`은
  다이얼로그·시트의 기본 차단, `strong`은 스포트라이트처럼 완전히 덮을 때.
  검정 알파를 손으로 적지 않는다. (회수 전 실측 35·45·55·65·72% 5종 10곳 → 3단)
- **간격(`gap`)**: `1 · 1.5 · 2 · 3 · 4 · 6` **6단**. 실측 289곳이 14단(`0`·`0.5`·`2.5`·`3.5`·
  `5`·`5.5`·`7`·`8` 포함)으로 벌어져 있던 것을 좁혔다 — 라운드 28종→7단과 같은 처방이다.
  - **사다리 밖 값이 필요하면 단을 새로 만들지 말고 가장 가까운 단으로 간다. 동점이면 좁은
    쪽이다** — 지원 하한 320px에서 넓히는 쪽이 넘칠 위험이 있다. (이 규칙으로 옮긴 내역:
    `2.5→2` 28곳 · `0.5→1` 10곳 · `5→4` 9곳 · `8→6` 4곳 · `3.5→3` 3곳 · `7→6` 3곳 · `5.5→6` 1곳)
  - `gap-0`은 쓰지 않는다 — grid·flex 기본값이라 아무 일도 하지 않는 클래스다.
  - 흡수된 단 중 **`0.5`(2px)만 용도가 뚜렷했다** — 라벨+값 두 줄 묶음의 행간으로 4개 도메인
    10곳이 같은 모양(`grid gap-0.5` · `flex flex-col gap-0.5`)이었다. `1`(4px)로 올렸으니 이
    묶음들이 뜨게 느껴지면 되돌릴 자리는 여기다.
- **safe-area**: `pt-safe-top` · `pb-safe-bottom` 두 토큰만 — 25곳이 각자 손으로 쓰던
  산술을 하한 2종으로 수렴(위아래가 다른 것은 의도 — 아래는 홈 인디케이터를 더 피한다).

## 화면 프레임

화면에서 `min-h-dvh`·`h-svh` 껍데기를 새로 쓰지 않는다 — **`Screen`이 높이 정책과
safe-area를 소유**하고, `PlayBoard`(게임판)·`ControllerScreen`(폰 컨트롤러)·
`GameCanvas`(3D 코트·결투장·랜딩 히어로처럼 한 뷰포트를 채우고 안에서 절대배치로 겹치는
화면)가 감싼다. 확장은 props가 아니라 `className`으로.

`GameCanvas`는 **배경색을 들지 않는다.** 게임마다 세계관이 달라 팔레트를 나눠 둔 것이라
(`pp-*`·`duel-*`·`landing-*`), shared가 도메인 색을 알면 의존 방향이 뒤집힌다. 배경과
내부 배치는 호출부가 얹는다.

주의점(코드 주석 근거):

- Tailwind v4에는 `--duration-*` 테마 네임스페이스가 없다 — 이름 있는 duration class가
  존재할 수 없으므로 `duration-(--ds-motion-base)`처럼 원시값을 직접 참조한다.
- 최대 굵기 700 — 800은 Pretendard에서 뭉개진다.
- 브레이크포인트: 760px는 DOM 구조가 갈려 JS(`useMediaQuery`), 1200px(`desktop:`)은
  스타일만 갈려 variant, 320~359px 압착은 `max-tiny:`.
- 명도 대비: 디자인 Disabled Text(#67686E)는 3.6:1이라 본문에 못 쓴다 — 4.5:1을 넘는
  밝기로 올리고 비활성은 opacity로. 사용한 족보 칸은 색 외에 빗금 패턴(`--ds-hatch-used`)
  이라는 두 번째 채널을 쓴다.

## `cn()` — tailwind-merge에 커스텀 토큰 등록

`clsx → extendTailwindMerge`. **커스텀 `@theme` 키는 반드시 등록한다** — 등록하지 않으면
"모르는 class"로 취급돼 충돌 그룹에 못 들어가고, 컴포넌트 기본값과 호출자 override가 둘 다
살아남아 승자를 빌드된 CSS 선언 순서가 정한다. 그러면 "외부 배치는 className으로
확장한다"는 규칙이 성립하지 않는다. (spacing·radius·shadow·text·font-weight·ease·animate
+ z 그룹 등록)

## 레시피 (`recipes.css`)

기준: **렌더된 DOM에 5번 이상** 반복되는 class 조합만. 현재 목록은
[`recipes.css`](../../src/styles/recipes.css)가 정본이다 — 여기에 개수를 적지 않는다
(레시피가 늘 때마다 어긋난다). 소스는 이미 DRY지만 같은 200~300자 문자열이 화면 하나에 12번 찍혀
게임 화면 HTML 34.5KB 중 31%가 완전 중복이었다.

`@utility`가 아니라 `@layer components`인 이유: v4 레이어 순서(theme→base→components→
utilities)에서 레시피가 **항상 인라인 유틸리티에게 진다** — `cn('score-row', 'bg-brand/10')`
덮어쓰기가 순서와 무관하게 이긴다. `@utility`면 같은 레이어라 선언 순서 싸움이 되고
tailwind-merge도 커스텀 이름을 모른다.

## 모션 — 두 구현체의 경계

| | CSS keyframes (`tokens.css`) | `motion` (`shared/motion.ts`) |
|---|---|---|
| 담당 | 장식·상태 강조 (DOM에 있는 채로 반복/한 번 튐) | 진입·퇴장·제스처 (나타나고 사라지는 것) |
| 이유 | 컴포지터에서 도는 순수 CSS — 물리 시뮬 중에도 JS 프레임을 쓰지 않는다 | 언마운트를 붙잡아야 퇴장이 그려진다(`AnimatePresence`) |

**돌아가는 CSS 애니메이션을 motion으로 옮기지 마라** — 주사위가 구르는 동안 도는 것에 JS
프레임을 쓰면 rapier 스텝과 같은 프레임을 다툰다. 지속시간·이징은 `motion.ts`의
`DURATION`/`EASE_*`와 `--ds-motion-*`이 같은 값을 양쪽에 적은 것 — 한쪽만 고치지 않는다.
`transform`·`opacity`만 보간한다. `motion-reduce`는 개별 중화. `m`+`LazyMotion` 대신
`motion.*`(provider 없는 렌더 경로가 있다). jsdom에는 WAAPI가 없어 테스트 setup이
motion을 mock한다 — [testing.md](./testing.md).

화면 전환(View Transitions)은 [app-shell.md](./app-shell.md) 참고.

## 전역 타이포·레이아웃 (`global.css`)

- 한국어 어절 줄바꿈: `word-break: keep-all` + `overflow-wrap: break-word` 안전망,
  `h1–h3 balance` / `p pretty` — `<br>` 수동 고정을 전역 규칙으로 대체.
- **지원 하한 320px** (`min-width: 320px`) — E2E `mobile-320` 프로젝트가 이 선을 지킨다.
- `min-height: 100dvh` — iOS 브라우저 크롬 접힘 대응. `touch-action: manipulation`.
- 모든 화면은 정확히 한 뷰포트를 프레임으로 잡는다 — 문서가 자라는 화면을 하나만 섞으면
  화면마다 스크롤 주체가 달라진다.

## 컴포넌트 규칙

1. 공통 `Button` 우선, 한 화면에 레드 Primary는 하나. `Button`으로 표현할 수 없으면
   **Button을 감싼 얇은 컴포넌트**를 만든다(선례: `GameChromeButton` — 게임 크롬 알약
   버튼 7곳을 하나로). 감싸는 쪽에 스타일을 쌓지 말고 variant map에 추가한다.
   - 색이 **게임 팔레트**(`pp-*`·`duel-*`)면 래퍼를 shared가 아니라 **그 도메인 안**에
     둔다 — shared가 도메인 색을 알면 의존 방향이 뒤집힌다(선례: `PingPongButton` ·
     `DuelButton`, 액션 버튼 9곳을 흡수).
   - **생 `<button>`이 정당한 자리** (2026-08-18 전수 분류, 59곳): 셸 내부 기능
     버튼(Modal 닫기·Popover/Tooltip 트리거·스크림), 화면 전체가 입력면인 게임
     아레나, 정적 map으로 이미 흡수된 리스트 행(`rowStyles`·`ScoreRow`), 랜딩
     세계관(`landing-*` 팔레트·자체 CTA map), 24px 이하 글리프·아이콘 버튼. 이
     갈래에 안 드는 새 생 버튼은 Button(또는 래퍼)으로 간다.
2. variant·tone은 **정적 class map** — 동적 문자열 조립 금지. 둘 중 어느 이름을 쓰는지는
   [DESIGN.md](../../DESIGN.md) 원칙 8이 정한다(위계가 바뀌면 `variant`, 색만 바뀌면 `tone`).
   새 이름을 만들지 않는다
3. 외부 배치는 `className`, 내부 구조·상태는 컴포넌트 소유
4. 클릭 요소 최소 `min-h-tap`(44px)
5. focus ring·**pressed**·disabled·loading·error·reconnect 상태 누락 금지 — pressed는
   hover가 없는 터치에서 "닿았다"를 알리는 유일한 채널. 값은 `recipes.css`의
   `pressable`(scale 0.97) 한 곳에만 두고 `active:scale-*`를 직접 적지 않는다
   (예외 2종 — 24px 이하 글리프, 눌림을 빼는 자리 — 는 그 자리에 이유를 적는다)
6. 상태를 색 하나에 싣지 않는다 (모양·라벨·패턴 병행)
7. 아이콘은 `shared/components/Icon.tsx`로 모은다 — 이모지·글리프 금지(예외: 이모지가
   곧 콘텐츠인 리액션 픽커)

공통 컴포넌트 목록과 각각의 설계 결정은 [shared-ui.md](./shared-ui.md),
카탈로그는 `/__dev/components`.
