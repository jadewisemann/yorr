# IMPLEMENTATION NOTES — working memory

> 작업 중 발견한 숨은 불변식·실측값·edge case·실패한 접근을 날짜와 함께 적는
> **휘발성 메모**다. 영구 지식은 성격에 따라 승격하고 여기서 지운다 —
> 설계·불변식은 [DESIGN.md](DESIGN.md), 동작 상세는 해당 llmwiki 페이지,
> 함정·실측값은 [code-rationale.md](docs/llmwiki/code-rationale.md).
> 규칙은 [AGENTS.md](AGENTS.md) 참고.
>
> 형식: `## YYYY-MM-DD - 주제` 아래에 불릿. 최신이 위.

## 2026-08-18 - 시각 대조 도구와, 그것을 막고 있던 전제 2개의 판정

PLANS.md「검증 수단의 구멍」이 색 회수(라이트 모드 1순위)의 선행 작업으로 잡아 둔
것을 만들었다(`npm run test:visual`). 착수 전에 적혀 있던 전제 두 개가 실측에서
틀렸고, 둘 다 **문서가 낡은 쪽**이라 문서를 고쳤다(AGENTS.md 판정 절차).

- **"baseline은 Jenkins 환경에서 떠야 한다 — 로컬·컨테이너에서 만들면 CI가 영구히
  빨개진다."** `Jenkinsfile`의 프론트엔드 스테이지는 `npm ci` → `check` →
  `typecheck` → `test` → `build`뿐이다. **Playwright를 실행하는 스테이지가 없다.**
  같은 스테이지의 `archiveArtifacts`가 `frontend/playwright-report/**`를 걷고 있어
  E2E가 도는 것처럼 읽히지만, 그 경로를 채우는 실행이 없다 — 오해의 출처가 이것으로
  보인다. 결론: 빨개질 CI가 없으니 제약도 없다. 대신 **baseline을 지켜 줄 CI도
  없으므로** 저장소에 넣지 않고(`.gitignore`) 한 기계 안 before/after로만 쓴다.
- **"`/__dev/components` 카탈로그 한 장이면 프리미티브 전체가 커버된다."**
  `src/shared/components/*.tsx` 17종 중 카탈로그에 등재된 것은 7종이었다. 색 회수가
  건드리는 `GameChromeButton`(`border-white/15·20`, `bg-black/45`, `text-white/70`)과
  `BottomSheet`(`bg-white/24`)를 이번에 등재했다. 남은 8종은 그것을 고칠 때 등재한다.

**설계상의 선택 두 가지 (되돌릴 때 근거)**

- **페이지 한 장이 아니라 섹션 단위.** 카탈로그에는 물리 주사위 렌더러(three.js·
  rapier)·음성 랩·마스코트 가이드가 섞여 있어 한 장으로 찍으면 매 실행 diff가 난다.
  세 섹션을 빼고 나머지를 섹션별로 찍는다.
- **프로덕션 빌드가 아니라 vite dev 서버.** `DevCatalog`가 `import.meta.env.DEV`
  게이트 안이라 빌드 산출물에는 "개발 환경에서만 사용할 수 있습니다" 한 줄만 남는다.
  기존 `playwright.config.ts`(preview :4306)를 재사용할 수 없는 이유가 이것이라
  설정을 따로 뒀다(`playwright.visual.config.ts`, :5310).

**함정** — 카탈로그를 열면 마스코트 가이드가 페이지를 덮은 채 시작한다. 어떤 섹션을
찍든 "연습 그만두기"로 먼저 걷어내야 뒤가 보인다.

**함정 2 — 도구가 조용히 무력해지는 설정.** 처음에 `maxDiffPixelRatio: 0.002`(안티
앨리어싱 몫)로 잡았더니 헤어라인 회수(아래)가 **12개 섹션 전부 통과**했다. 조여서
`maxDiffPixels: 0`으로 바꿔도 여전히 통과했다. 원인은 Playwright가 임계값을 **둘**
갖는다는 것 — `maxDiffPixels`(몇 픽셀까지 봐주나)와 `threshold`(픽셀 하나가 얼마나
달라야 "다른 픽셀"인가, YIQ 색 거리, **기본 0.2**). 헤어라인 15%→14%는 `#111214` 위에서
채널 3/255 차이라 기본 threshold가 통째로 삼킨다. `threshold: 0`을 함께 주고서야
664픽셀(버튼 4개의 테두리 둘레)로 잡혔다. **이 도구를 손볼 일이 있으면 threshold부터
확인한다** — 0이 아니면 색 작업에 대해 아무것도 검증하지 않는다.

## 2026-08-18 - 라이트 테마 층 — 회수의 값을 받는 자리

`[data-theme="light"]` 오버라이드 한 블록. **컴포넌트도 semantic 층도 손대지 않았다** —
`@theme inline` 덕에 원시값만 덮으면 화면 전체가 따라온다. 회수 78곳이 없었으면 이
블록은 아무것도 못 바꿨을 것이다.

**켜자마자 raw 예외 2건이 버그로 드러났다.** 이게 라이트 모드를 실제로 렌더해 본
값이다 — 논증으로는 안 나왔다.

- `Button` ghost `border-white/28` → **흰 배경에 흰 테두리**라 버튼 윤곽이 통째로
  사라졌다. 배경이 투명해 테두리가 버튼의 전부인 컨트롤인데 그 전부가 없어진 것이다.
  `--ds-color-border-ghost`로 올렸다(다크 흰 28% / 라이트 검정 28%). **사다리 밖 값도
  토큰이어야 한다**는 게 이번 교훈이다 — raw는 테마를 따라가지 못한다.
- `Button` secondary `hover:bg-white` → 라이트에서 `inverse`가 어두운 칩인데 hover에
  흰색으로 **뒤집혔다**. `--ds-color-inverse-hover`로 올렸다. 규칙은 "hover는 캔버스에서
  더 멀어지는 쪽" — 다크에서는 밝아지고 라이트에서는 어두워진다.

**대비를 계산하고 나서 값을 세 번 고쳤다.** 다크용 파스텔은 흰 배경에서 전부 무너진다
(`positive` #8fcb9b는 라이트 canvas 위 1.5:1). 첫 안의 `content-faint` 4.38 ·
`positive` 4.26이 4.5 미달이라 `#616269`(5.08) · `#27703a`(5.07)로 내렸다. 라이트 최종:
content 14.99 · muted 6.12 · faint 5.08 — 다크(18.58 · 8.11 · 5.28)와 같은 위계다.

**남은 대비 구멍 1건 (라이트를 사용자에게 켜기 전 필수).** `text-brand`(민 `brand`)가
라이트 canvas 위 **3.54:1**로 미달이다 — 다크에서는 4.71이라 성립했다. `brand`는 두
테마 공통 레드라 값을 못 바꾸고, 빨간 글자의 자리는 원래 `brand-soft`(라이트 5.53)다.
옮길 곳 3곳: `Badge` brand 톤 · `NotFoundPage` 장식 R · `DuelHowTo` 상태 문구.
`bg-brand` + `on-brand`(흰 글자 4.23)는 두 테마 공통이라 이 건과 무관하다.

**표면 사다리는 다크와 방향을 같게 뒀다** — canvas에서 멀어질수록 밝아진다
(canvas #ebebe8 → overlay #ffffff). 흰 배경에 흰 카드를 띄우는 통상 관례와 어긋나
보이지만, 다크가 다섯 단을 명도로 구별하고 컴포넌트가 그 위계에 기대고 있어서
관계를 뒤집으면 `raised`와 `overlay`가 같은 색이 된다.

**시각 대조에 나타난 것**: `Button`·`Modal open`이 각각 196·216픽셀 diff. 전부 ghost
테두리고, **채널당 최대 1/255**이다 — Tailwind의 `white/28`이 oklab `color-mix`를
거치는 것과 리터럴 `rgb(255 255 255 / 28%)` 사이의 반올림 차이다. 눈으로는 같고,
`threshold: 0` 하네스라서 잡혔다. 다크 겉모습은 그대로다.

## 2026-08-18 - 글자·외곽선 색 회수와, 그 과정에서 드러난 중복 3건 (색 회수 4/4)

`text-white` 17곳 + `outline-white` 4 + `stroke-white/35` 1. 사다리를 새로 만들 일은
없었다(`content`군이 이미 3단) — 대신 **회수하고 나니 원래 있던 중복·무의미가 드러났다.**

| raw | 곳 | 간 곳 |
|---|---|---|
| `text-white` (Screen 바닥·GameCanvas 호출부·ResultBackdrop·feedback 기본값) | 14 | `text-content` |
| `text-white/70` (GameChromeButton canvas 톤) | 1 | `text-content-muted` — **유일하게 눈에 보이는 변화** |
| `text-white/4` (NicknamePage 대형 워터마크 숫자) | 1 | `text-content/4` |
| `disabled:text-white/35` | 1 | `disabled:text-content/35` |
| `stroke-white/35` (RollCounter 빈 칸) | 1 | `stroke-content/35` |
| `outline-white` (랜딩 포커스 링) | 4 | `outline-focus` (`#f7f7f5`, 값 동일) |

**드러난 중복 1 — `GameCanvas` 호출부 9곳이 셸의 기본값을 덮고 있었다.** `GameCanvas`는
이미 `text-content`를 들고 있는데(`Screen.test.tsx`가 그 class 집합을 단언한다) 호출부가
`text-white`로 덮어써 왔다. 회수하고 나니 `text-content text-content`가 돼서 **호출부
쪽을 지웠다.** "외부 배치는 className, 내부는 컴포넌트 소유" 규칙이 색에서 새고 있던
자리다 — 프리미티브가 기본값을 들면 호출부는 그것을 다시 적지 않는다.

**드러난 중복 2 — `TurnStrip`의 현재 턴 표시에 렌더되지 않는 채널이 하나 있었다.**
점수 줄이 `active ? 'text-white' : 'text-content'`였는데 `#ffffff` 대 `#f7f7f5`,
채널당 8/255라 화면에서 구별되지 않는다. 현재 턴은 이미 `aria-current="step"` ·
마커 모양(`rounded-xs bg-brand-strong` 대 `rounded-full bg-content-faint`) · 이름
색(`text-brand-soft`)으로 **세 채널이 들고 있어** 이 네 번째는 의도만 있고 효과가
없었다. 삼항을 걷어내고 이유를 주석에 남겼다. 색 대비를 실제로 주고 싶다면 여기가
그 자리다 — 지금은 없던 것을 없앤 것이지 있던 것을 지운 게 아니다.

**드러난 중복 3 — `physics` 네임스페이스에는 지켜지는 불변식이 있다.** `Dice.tsx`의
`border-black/15`를 `--ds-color-physics-die-edge`로 올렸다가 되물렀다.
`tokenFallbacks.test.ts`가 **"`--ds-color-physics-*` 전부가 JS fallback 맵에 있어야
한다"**를 강제한다 — 그 네임스페이스의 뜻이 "3D 렌더러가 `dsColor()`로 읽는 색"이기
때문이다. CSS에서만 쓰는 값을 넣으면 렌더러가 쓰는 것처럼 거짓말이 된다. 다이 모서리는
**주석 달린 raw 값으로 남겼다** — 다이는 실물 주사위라 라이트에서도 상아색 면에 검은
모서리다. 순백 4곳(QR 정숙 구역 등)과 같은 처방이다.

**검증**: 시각 대조 diff 664 → 978픽셀. 늘어난 314가 `GameChromeButton` canvas 톤의
글자(`white/70` → `content-muted`, `#b9b9b9`→`#a4a5aa`)고, diff 이미지에서 overlay 톤
버튼의 글자는 안 움직였다 — 그 톤은 muted를 안 들기 때문이다. 의도한 것만 움직였다.

**색 회수 78곳 완료.** 남은 raw 색 6곳은 전부 **주석 달린 의도적 예외**다 —
`Button` ghost `border-white/28`(대비 근거), 순백 4곳(QR 정숙 구역 2 · 탁구공 ·
`Button` secondary hover), `Dice` 모서리.

## 2026-08-18 - 면(veil) 3단과 흰색 배경 알파 회수 (색 회수 3/4)

`bg-white/N` 19곳, 실측 8종(4·6·8·10·12·15·20·24%). 스크림 때와 같은 교훈이 또
나왔다 — **값을 세지 말고 역할을 세면 갈래가 준다.** 8종이 실제로는 5가지 일이었다.

| 역할 | raw | 곳 | 간 곳 |
|---|---|---|---|
| 면 — 칩·배너·카드 바닥 | 6·8 | 12 | `surface-veil` (6%) |
| hover | 4 | 1 | `surface-veil` — `Button` ghost의 `hover:bg-surface-veil` 선례 |
| disabled 배경 | 10 | 1 | `surface-veil` (동점이면 낮은 단) |
| 눌림(`active:`)·미도달 점 | 12·15 | 2 | `surface-veil-raised` (14%) |
| 시트 손잡이 | 24 | 2 | `surface-veil-strong` (24%, 일치) |
| **1px 세로 구분선** | 20 | 1 | **`bg-border-strong`** — 면이 아니라 선이다 |

**`surface-veil`의 값을 6%로 유지한 이유** (8%가 raw 다수파 8곳이었는데도): 토큰 값을
바꾸면 이미 `bg-surface-veil`을 쓰는 6곳이 함께 움직이는데 그중 `Button`·
`GameChromeButton`·`ConnectionBanner`가 공용 프리미티브라 파급이 화면 전체다.
**호출부 8곳을 −2%p 움직이는 쪽이 토큰 1개를 +2%p 움직이는 쪽보다 좁다.**
design-system.md가 6%를 이미 정본으로 적어 둔 것과도 맞다. 되돌릴 지점: 게임 화면
카드 8곳이 옅어 보이면 여기다.

**`w-px bg-white/20`을 veil이 아니라 헤어라인으로 보낸 것**이 이번 조각의 판정이다.
`bg-*`라서 표면 갈래에 세어 뒀는데, 실제로는 폭 1px짜리 세로 분할선이라 성격이
`border`다. **속성(`bg-`)이 아니라 역할로 가른다.**

순백 `bg-white` 4곳은 회수 대상이 아니라 **주석을 달았다** — QR 정숙 구역 2곳(스캐너가
코드를 찾는 기준이라 테마를 따라가면 안 된다), 탁구공 1곳(표면이 아니라 공 그 자체),
`Button` secondary hover. 라이트 모드 작업자가 "회수 누락"으로 보고 고칠 자리라서다.

**검증**: 시각 대조 diff가 직전과 정확히 같은 664픽셀 — 보탠 픽셀 0.
`Bottom sheet open`이 통과한 것이 손잡이 24% 일치를 확인해 준다.

## 2026-08-18 - 스크림 3단 신설과 검정 알파 회수 (색 회수 2/4)

`bg-black/N` 10곳. 헤어라인과 달리 **흡수층이 아예 없었다** — `--ds-color-scrim` 66%
한 단뿐이고 그것도 `Modal`·`BottomSheet`·`Popover`·`RecordPanel` 4곳이 쓰고 있어서,
게임 화면들은 갈 곳이 없어 손으로 적고 있었다. 사다리를 먼저 만들고 옮겼다.

**갈리는 기준이 진하기가 아니라 역할이었다.** 10곳을 읽어 보니 두 갈래다.

- **판(plate)** — 3D 코트·결투장 위에서 글자를 읽히게 하는 배경. 뒤를 가리는 게
  목적이 아니고 대개 `backdrop-blur`와 짝이다. 점수 배지·카운트다운·에러 알약·게임
  크롬 버튼 (35·45·55%)
- **차단(backdrop)** — 다이얼로그·코치마크 뒤를 덮어 상호작용을 막는다. 준비
  다이얼로그·종료 다이얼로그·툴팁 코치마크·튜토리얼 스포트라이트 (45·65·72%)

3단으로 잡았다 — `scrim-soft` 45% / `scrim` 66%(기존 값 유지) / `scrim-strong` 72%.

| raw | 곳 | 간 곳 | 움직임 |
|---|---|---|---|
| `/35` | 2 | `scrim-soft` | **+10%p — 되돌릴 지점** |
| `/45` | 3 | `scrim-soft` | 일치 |
| `/55` | 1 | `scrim-soft` | **−10%p — 되돌릴 지점** |
| `/65` | 2 | `scrim` | −1%p |
| `/72` | 2 | `scrim-strong` | 일치 |

**겉모습이 움직인 곳은 3곳뿐이고 전부 카탈로그 밖이다** — `CourtOverlay`의 점수
배지와 `ControllerArena`의 카운트다운이 진해지고(35→45), `DuelGame`의 에러 알약이
옅어진다(55→45). 셋 다 3D 캔버스 위 판이라 같은 단으로 모은 것인데, 진해진 둘은
가독성이 오르는 방향이고 옅어진 하나는 `text-red-300`이 이미 대비를 들고 있다.
**뜨거나 답답하게 느껴지면 여기가 되돌릴 지점이다.**

`bg-scrim`(66%)을 쓰던 기존 4곳은 값이 그대로라 안 움직인다 — 시각 대조에서
`Modal open`·`Bottom sheet open`이 픽셀 단위로 동일했다. `GameChromeButton`
overlay(45% → `scrim-soft` 45%)도 무변화가 확인됐다: 헤어라인 회수 때와 diff가
정확히 664픽셀로 같아, 이번 변경이 보탠 픽셀이 0이다.

## 2026-08-18 - 헤어라인 흰색 알파 회수 (색 회수 1/4)

`border-white/N` 22곳(테스트 제외)을 헤어라인 3단으로 옮겼다. 사다리는 이미 코드에서
다수파였다 — `border-border` 94곳 · `border-border-raised` 7 · `border-border-strong` 8
대 raw 22. 규칙이 없어서가 아니라 **재고를 안 치웠던 것**이다(2026-08-16 감사의 그 패턴).

| raw | 곳 | 간 곳 | 근거 |
|---|---|---|---|
| `/8` | 2 | `border` (10%) | 가장 가까운 단 |
| `/12` | 5 | `border` (10%) | 10·14와 등거리 — **동점이면 낮은 단**(아래) |
| `/15` | 8 | `border-raised` (14%) | 가장 가까운 단 |
| `/18` | 1 | `border-strong` (18%) | 일치 |
| `/20` `/22` | 5 | `border-strong` (18%) | 가장 가까운 단 |
| `/28` | 1 | **그대로** | Button ghost. 사다리 밖 예외 — 이유를 코드 주석으로 옮겼다 |

**새로 굳힌 규칙: 알파가 두 단의 정중앙이면 낮은 단으로 간다.** `gap` 6단의 "동점이면
좁은 쪽"과 같은 처방이고 근거도 같은 종류다 — 헤어라인은 올리면 UI가 시끄러워지고,
되돌리기는 낮춘 쪽이 쉽다. 마침 `/12` 5곳은 전부 캔버스 위(떠 있지 않은) 표면이었고
그중 3곳은 `bg-white/6`(= `surface-veil`)과 짝이라 문맥도 낮은 단을 가리켰다.

`Button` ghost `/28`은 값 자체에 근거가 있었는데(`border-strong` 18%는 캔버스 위
1.62:1로 **비활성** Primary 2.10:1보다 흐리다) 그 근거가 코드에 없고 design-system.md가
"선례"로 가리키기만 했다. 주석으로 옮겼다 — 다음 사람이 사다리에 맞춘다며 지울 값이다.

**검증**: `npm run test:visual`이 `Game chrome` 한 섹션만 664픽셀 diff로 잡았고
(GameChromeButton 15→14% · 20→18%) 나머지 11개는 픽셀 단위로 동일했다. diff 이미지가
버튼 4개의 테두리 둘레만 칠했다 — 의도한 것 외에는 아무것도 안 움직였다는 뜻이다.
카탈로그 밖 19곳은 이 도구가 못 본다(pingpong·duel·yacht 화면).


## 2026-08-16 - 문서·코드 불일치 감사와 판정

AGENTS.md의 판정 절차("조용히 코드를 따르지 않는다 — 의도가 바뀐 것이면 문서를,
구현이 틀린 것이면 구현을 고친다")를 문서 주장 전수에 적용했다. 판정 결과 7건.

**문서가 낡은 것 → 문서를 고쳤다 (3건)**

- `design-system.md` "레시피 5종" → 실제 7종. **개수를 지우고 recipes.css 참조로
  바꿨다.** 숫자는 코드가 자라면 반드시 어긋난다 — 이 감사의 진짜 교훈이다.
- `shared-ui.md` "Icon 고정 10종" → 실제 11개(`IconShake` 추가). 같은 처방.
- `CONTRIBUTING.md` "main은 Protected Branch로 잠가둔다" → **실제로는 안 켜져
  있다**(GitHub API `protected: false`). 문서를 믿고 `git push origin main`을 치면
  그대로 들어가므로 오기 중 가장 위험했다. 규칙("직접 push 금지")과 현재
  상태("강제 수단 없음")를 분리해 서술했다. 켜는 조건은 협업자 합류 시점 —
  리뷰어 필수 복구와 묶는다.

**구현이 틀린 것 → 문서는 그대로 두고 부채로 기록 (4건)**

규칙 자체는 옳으므로 문서를 완화하지 않는다. PLANS.md "남은 격차"에 있다.

| 규칙 | 위반 |
|---|---|
| `design-system.md` 규칙 1 "공통 Button 우선" | 생 `<button>` 93개 |
| 사다리 "눈대중 `white/NN` 금지" | 49곳(알파 7종) |
| 화면 프레임 "`h-svh` 껍데기 금지" | 10곳 (이번 세션에 22 → 10) |
| DESIGN.md 원칙 7 "200줄 기준선, 넘길 때 이유를 남긴다" | 10개 초과. `duel/components/Arena.tsx` 915줄(4.6배)·`app/RealtimeSync.tsx` 358줄·`yacht/screens/GamePlay.tsx` 334줄 — **셋 다 이유 주석이 없다** |

**공통 패턴 — 재발 방지책**

넷 다 "금지 규칙을 새로 적으면서 **기존 재고를 안 치우고** 넘어간" 것이다. 새
코드는 규칙을 따랐지만 재고가 남아 규칙이 무력화됐다. 이번 세션의 `card/panel`
규칙과 `gap` 6단은 재고까지 치우고 썼고, 그래서 지금 위반 0이다. **규칙을 적을
때 기존 위반 수를 세고, 치우거나 부채로 티켓을 남긴다.**

**확인했더니 문제 아니었던 것**

- `active:scale-*` 6곳 — 규칙이 예외 2종을 허용한다(24px 이하 글리프, 눌림 빼는
  자리). 개별 확인은 남았지만 즉시 위반은 아니다.
- `docs/llmwiki/index.md`가 DESIGN.md 지도에 없다 — DESIGN.md로 보내는 리다이렉트
  스텁이라 의도된 것이다.
- 배럴 `index.ts` 0개, Tailwind 기본 라운드(`rounded-2xl` 등) 0곳 — 완전 준수.
- DESIGN.md의 경계 예외 2건은 여전히 존재하지만 **문서가 이미 정직하게 기록**하고
  이관 티켓까지 달아 뒀다. 불일치가 아니다.

## 2026-08-14 - 문서 체계 전환 (ADR-0001)

- 동기화 기준선: llmwiki는 2026-08-13 전면 개편본(코드에서 추출·작성)이고,
  전환 시점에 구조 주장을 코드와 대조해 확인했다 — `src/` 도메인 구성,
  biome `noRestrictedImports`(duel·landing·pingpong·yacht), `check:cycles`
  스크립트, `games.ts` 카탈로그, `wsEvents.ts` envelope 모양.
- `.dev.md`(git 미추적, 티켓 215 측정 근거)는 그대로 둔다. 앞으로의 작업 발견은
  이 파일(추적됨)에 적는다 — 세션이 끝나도 팀에 남게.
- 티켓 25: `sys.reconnect`는 서버에 라우팅이 없어 보내면 조용히 버려진다.
  재접속은 `room.join` 재전송으로 통일되어 있다(`app/RealtimeSync.tsx`).
  백엔드 마이그레이션 Phase 1·2에서 이 실제 동작이 계약이다 — 문서상 이벤트
  목록만 보고 sys.reconnect를 구현 대상으로 잡지 말 것.
