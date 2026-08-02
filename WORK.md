# S15P11A406-169 · UI 리팩터링 인수인계 문서

> **새 세션은 이 문서 하나만 읽고 이어서 작업한다.**
> 기준일 2026-08-03 · 브랜치 `refactor/S15P11A406-169-ui-design-system` · 커밋 30개
> push 안 함 · MR 없음 · `develop` 무변경

---

## 0. 시작하기

```bash
cd C:\Users\appel\Downloads\_ssafy\S15P11A406-169-ui-design-system\frontend
npm run dev -- --port 5190 --strictPort
```

| | |
|---|---|
| 워크트리 | `C:\Users\appel\Downloads\_ssafy\S15P11A406-169-ui-design-system` |
| 메인 저장소 | `C:\Users\appel\Downloads\_ssafy\S15P11A406` (develop) |
| Jira | [S15P11A406-169](https://ssafy.atlassian.net/browse/S15P11A406-169) |
| 현재 상태 | `biome check src/` 클린 · **821/821** · `tsc` 0 · build OK |

**먼저 확인할 것:** `git log --oneline develop..HEAD` (30개), 이 문서의 §5 체크리스트.

---

## 1. 작업 규칙 — 사용자가 명시한 것

| # | 규칙 | 배경 |
|---|---|---|
| **R1** | **로직을 건드리지 않는다.** UI·스타일링만. | "코드 리펙토링은 하나도 하지마" → 되물으니 "UI나 스타일링 말고 **로직**을 말한 것". 실제로 로직 커밋 2개를 걷어냈다가 "저거 정도는 있는 게 맞다"고 해서 복구함. **판단 기준: 화면이 어떻게 보이는가 = 허용, 앱이 무엇을 하는가 = 확인 필요.** |
| **R2** | **디자인 판단을 직접 내리지 않는다.** 디자인 스킬을 받아 에이전트에 위임한다. | "니가 디자인 개선을 판단하지 말고 클로디 디자인을 호출해서 부분 부분 디자인 하게 해서 만들던가 스킬을 사용해서 하던가 해. 지금 ui 별로야" |
| **R3** | 승인은 최소로. 승인 불필요한 건 전부 하고 **마지막에 한 번에** 묻는다. | "어지간하면 승인 구하지 말고 다 진행하고 정 필요하면 승인 필요 없는 부분 전부 진행한 다음에 한번에 물어봐" |
| **R4** | 커밋은 작게. 커밋마다 변경사항을 보고 취사선택할 수 있게. | 최초 지시 |
| **R5** | 주사위 물리(`src/rendering/physics-dice/`)는 **아주 안전한 부분만**. 로직이 복잡함. | "코어 게임 물리 렌더링은 신경 많이 써서 진행해" |
| **R6** | 했던 작업을 반복하지 않는다. 체크리스트로 관리. | 이 문서를 만든 이유 — 초대 코드 배치를 4번 왔다갔다 함 |
| **R7** | 한국어 응답은 **존댓말**. | 사용자 메모리 |
| **R8** | 브랜치명은 `type/S15P11A406-번호-설명` (Jira 풀키). `main`·`develop` 직접 커밋 금지. | `CLAUDE.md`, 사용자 메모리 |

---

## 2. 이 저장소에서 반드시 알아야 할 함정

새 세션이 같은 실수를 반복하지 않도록 실측으로 확인된 것만 적는다.

### 2-A. `sed -i`를 쓰면 안 된다
`core.autocrlf=true`이고 `.gitattributes`가 없어 **작업 트리가 CRLF**다. Git Bash의 `sed -i`는 파일 전체를 LF로 다시 써서 `biome`이 그 파일을 통째로 포맷 위반으로 잡는다. 커밋된 내용은 git이 정규화해 diff는 멀쩡하니 눈치채기 어렵다.
→ **Edit/Write 도구를 쓴다.** 이미 돌렸다면 `rm <files> && git checkout -- <files>`.
→ Node 스크립트로 `readFileSync`/`writeFileSync` 하는 건 CRLF를 보존하므로 안전하다.

### 2-B. `cn()`은 원래 프로젝트 토큰을 병합하지 못했다 (수정 완료)
`tailwind-merge`가 기본 설정이라 `@theme`으로 추가한 키(`tap`·`card`·`panel`·`gutter` 등)를 모르는 class로 취급했다. 실측 19건 중 15건 실패 — **색 토큰은 되고 치수 토큰은 전부 안 됐다.**
승자를 `cn()`이 아니라 빌드된 CSS 선언 순서가 정하고 있었고, 그 결과 주 CTA 5곳이 같은 className을 넘기는데 `size="lg"` 유무로 58px/44px로 갈렸다.
→ `src/cn.ts`에서 `extendTailwindMerge`로 등록 완료. **토큰을 추가하면 여기도 같이 고쳐야 한다.**

### 2-C. `duration-*` 유틸리티는 생성되지 않는다
Tailwind v4에 `--duration-*` 테마 네임스페이스가 없다. `tokens.css`의 선언이 아무 CSS도 만들지 않아 `duration-base`를 쓴 5곳이 조용히 기본 150ms로 떨어진다.
→ 아직 안 고쳤다. §5의 4-D.

### 2-D. jsdom + motion
- **WAAPI(`Element.animate`)가 없어** motion이 애니메이션을 시작조차 못 한다.
- 진입은 `initial`(opacity 0)에 멈추고, `AnimatePresence` 퇴장은 끝나지 않아 **닫은 다이얼로그가 DOM에 남는다.**
- `MotionGlobalConfig.instantAnimations`·`skipAnimations` 둘 다 효과 없었다.
- → `src/test/setup.ts`에서 **`AnimatePresence`를 통과 컴포넌트로 mock**해 해결. 마운트·언마운트가 motion 도입 전과 같아진다.
- 그래도 **motion이 소유한 요소의 `transform`·`opacity`는 단정할 수 없다.** 시트 드래그 거리 단정 4곳, `toBeVisible()` 2곳을 존재/행위 확인으로 바꿨다. 이유는 각 테스트 주석에 있다.
- **`m` + `LazyMotion`이 아니라 `motion.*`를 쓴다.** `m`은 provider가 없으면 애니메이션이 안 돌아 단독 렌더 테스트가 전부 깨진다.

### 2-E. `useMediaQuery`는 리사이즈만으로 다시 평가되지 않는다
브라우저에서 뷰포트를 바꾼 뒤 **반드시 리로드**해야 올바른 레이아웃이 렌더된다. 안 그러면 wide 클래스가 narrow 폭에 남아 잘못 측정한다.

### 2-F. Atlassian MCP 인증이 세션마다 끊긴다
티켓은 이미 있다. 상태 변경·코멘트가 필요하면 재인증하거나 직접 Jira에서 한다.

---

## 3. 감사 결과 (발견 51건, 근거 문서)

`npx ui-skills get`으로 스킬을 받아 그 지침대로 감사했다. **설치(`.claude/skills/`)가 아니라 받아서 읽는 방식**이다.

| 스킬 | 결과 |
|---|---|
| `improve-ui` | 계약 위반 **20건** (원시 hex, 탭 타깃, 포커스, z-index) |
| `baseline-ui` | 베이스라인 위반 **31건** (타이포, 모션 성능, 위계, 빈 상태, safe-area) — improve-ui와 **0% 겹침** |
| `animation-systems` | 모션 기준: 마이크로 120–200ms · UI 상태 180–260ms · 팝오버 220–320ms · 섹션 400–800ms, stagger 40–90ms, transform·opacity만, reduced-motion 필수 |
| `landing-page` | 랜딩 유형 **C(minimal conversion page)** — QR·링크는 high-intent 트래픽이라 스크롤 구조 불필요 |
| `fixing-accessibility` | **미사용.** 쓰겠다고 했으나 실제로 안 받았다. 접근성 작업은 위 두 감사 결과로 함 |

**잘 지켜지고 있던 것** (건드리지 말 것): 정적 class map 100%, motion-reduce 15/15 개별 중화, CSS-first `@theme`, keyframe+token 분리.

---

## 4. 완료된 작업 (커밋 30개)

`git log --oneline develop..HEAD`로 확인. 성격별 요약:

| 묶음 | 내용 |
|---|---|
| **기반** | `cn()` 토큰 병합 수정(+회귀 테스트) |
| **토큰 6** | 원시 hex **8곳 → 0곳**. `brand-soft`·`surface-overlay`·`inverse`/`on-inverse` 승격, `Modal` 스크림 통일, 0점 확정 버튼 `danger` variant |
| **접근성 6** | 탭 타깃 12곳 44px, 포커스 5곳, `alertdialog` 2곳, 결과 화면 나가기 확인 |
| **타이포 2** | `text-wrap: balance/pretty` 전역 + `<br>` 제거, `tabular-nums` 5곳 |
| **모션 성능 2** | `callout-pop` 컴포지터 전용화(물리 도는 중 54px 블러 재래스터 제거), 다이얼로그가 덮으면 히어로 3D 정지 |
| **safe-area 1** | 8곳 (세로 하단 3 + 가로 노치 5) |
| **랜딩 5** | 하단 CTA 잘림 구조 수정, 메타 태그 카드 안으로, 음소거 버튼, 레드 글로우 2곳 제거, 가치 제안 카피 + h1/h2 위계 |
| **성능 1** | 라우트 스플리팅 + 인라인 스플래시 |
| **motion 2** | `motion` 도입, 시트·모달·팝오버 진입/퇴장, 초대 코드 배치 확정 |

**측정된 성과**

| | gzip |
|---|---|
| 원본 초기 로드 | 165 kB |
| motion 도입 후 | 192.6 kB |
| **+ 라우트 스플리팅 (현재)** | **157.5 kB** |

랜딩 넘침(모든 화면 0): 360×640 · 375×667 · 390×844 · 430×932 · 932×430 · 1440×900

---

## 5. 남은 작업 체크리스트

### 5-1. 디자인 판단 필요 — **R2에 따라 스킬/에이전트에 위임**

내가 임의로 값을 정하지 않는다. 각 항목마다 디자인 스킬(`high-end-visual-design` · `gpt-taste` · `frontend-design` · `web-design-guidelines` 등)을 받아 에이전트에게 시안을 받고 적용한다.

> ⚠️ `mengto/design-taste-frontend`, `mengto/redesign-existing-projects`는 **404다.** 레지스트리 목록에는 있지만 실제로 못 받는다. `npx ui-skills list`로 먼저 확인할 것.

- [ ] **A. 모바일 초대 코드 진입이 잘 안 보임**
  - 현재: `CodeEntryRow` — 눌린 면(`bg-landing-well` + `border-landing-hairline-strong`) 전체 폭 44px, 코드 글리프 + `›`
  - 위치: narrow = 가치 제안 h1 바로 아래 / wide = 헤더 좌측
  - 사용자: *"모바일에서는 좀 잘보이면 좋겠는데"*
  - **제약(반드시 지킬 것):** ① 게임 CTA와 **다른 층**을 유지 ② 준비 중인 게임에서도 살아 있어야 함 ③ 게임 CTA 묶음 안에 넣지 말 것
  - 이 제약을 4번 어겼다. §7 참조

- [ ] **B. 메인(랜딩) 좌우 폭 제한**
  - 현재: `EntryPage`의 `<main>`이 `w-full`, 폭 제한 없음
  - 사용자: *"매인 페이지도 좌우폭 제한하고"*
  - 주의: 히어로 캐러셀이 이웃 카드를 화면 밖으로 걸치는 구조(`left-[-14.9%]`)라 폭을 제한하면 그 연출이 잘린다. 카드 띠는 전면 폭을 쓰고 **콘텐츠만** 제한하는 형태가 필요할 수 있다

- [ ] **C. 게임 화면 폭이 너무 작음**
  - 현재: `GamePlay`의 `<main>`에 `mx-auto max-w-content`(72rem = 1152px). wide는 `grid-cols-[1fr_32.5rem]`
  - 사용자: *"게임 화면은 폭이 너무 작아"* — 내가 정한 72rem이 과했다
  - 값 재검토 필요. 참고로 다른 4개 화면은 `max-w-2xl`(42rem)

- [ ] **D. 점수 시트가 위로 쏠려 있음**
  - 사용자: *"오른쪽 점수 시트는 너무 위에 쏠려 있고"*
  - wide 우측 `32.5rem` 열의 세로 정렬 문제. `GamePlay.tsx`의 `<section aria-label="점수 시트">` 참조

### 5-2. 기능 — 디자인 판단 불필요

- [ ] **E. 캐러셀 슬라이드 애니메이션**
  - 지금은 게임을 바꿔도 카드 **내용만 즉시 교체**된다. 슬라이드 전환이 원래 없다
  - `transition-transform`은 드래그 스냅백에만 걸린다
  - motion으로 구현. `LandingHeroCarousel.tsx`

- [ ] **F. 페이지 전환 애니메이션**
  - 사용자: *"페이지 이동시에도 앱처럼 이동 시킬 수도 있잖아?"*
  - TanStack Router + `AnimatePresence`. 라우트가 지연 로드라 `Suspense`와의 순서에 주의

- [ ] **G. 문서 개정** (motion 도입에 따른 필수 후속)
  - `frontend/docs/engineering/design-system.md:14` — "복잡한 animation은 CSS keyframes로" → motion과의 경계 명시
  - `frontend/docs/current-baseline.md` — 기술 기준에 의존성 추가
  - `frontend/CLAUDE.md` — "복잡한 animation만 CSS keyframes로 분리한다"
  - **경계를 안 그으면 다음 사람이 모든 애니메이션을 motion으로 옮긴다.** 이게 motion 도입의 진짜 리스크

- [ ] **H. 죽은 토큰 정리**
  - `--text-title` (사용처 0)
  - `--duration-fast/base/roll` (§2-C — 유틸리티 자체가 생성 안 됨)
  - `--color-physics-accent`/`-danger`의 `@theme inline` alias (원시값은 `appearance.ts`에서 사용 중이라 alias만)
  - `--spacing-content`는 **삭제 금지** — 게임 화면에서 쓰게 됐다

- [ ] **I. `fixing-accessibility` 스킬로 빠진 것 확인**

---

## 6. 확정된 설계 결정 (뒤집지 말 것)

| 결정 | 근거 |
|---|---|
| **랜딩은 단일 화면 유지**, 스크롤 구조 추가 안 함 | `landing-page` 스킬 유형 C. QR·링크 진입은 high-intent |
| **landing 네임스페이스 유지** (값 중복 6쌍 포함) | 사용자가 "제대로 된 랜딩을 만드는 방향"이라 확정 → 분리가 정당해짐 |
| **히어로가 남는 높이를 먹는 구조** (`flex-1` + `min-h`/`max-h`) | 고정 높이 + `h-svh overflow-hidden`이면 크롬 합계가 뷰포트를 넘어 하단 CTA가 잘린다. wide는 `flex-[999_1_0%]` — 아래 여백 블록도 flex-1이라 그냥 두면 데스크톱 카드가 절반이 된다 |
| **상태를 글로우로만 말하지 않는다** | 글로우는 야외·저대비·색각 이상에서 가장 먼저 사라진다. 카드 헤일로 90px 제거(테두리+배지가 이미 말함), 진행 막대 글로우 제거(폭+색이 말함) |
| **초대 코드는 게임 CTA와 다른 층** | 게임과 무관한 독립 진입 경로. 같은 층에 두면 "이 게임을 코드로 연다"로 읽힘 |
| **`LandingProgress`의 `transition-[width]`는 그대로** | `scaleX`로 바꾸려면 5칸이 선택 폭(48px)을 항상 차지해 240px 필요. 좁은 화면 줄이 넘침 |
| **타입 스케일 설계는 이번 범위 밖** | 하드코딩 폰트 134건/28종. 몇 단계로 줄일지는 디자인 결정이고 `CLAUDE.md`가 디자인 미확정 시 확대를 금지 |

---

## 7. 반복하면 안 되는 실수 (실제로 일어난 것)

| 실수 | 무슨 일이 있었나 |
|---|---|
| **초대 코드 배치를 4번 뒤집음** | ① live 분기 밖으로 빼서 준비 중인 게임에도 표시 → 사용자 거부 ② 안으로 되돌림 → 준비 중일 때 사라짐 ③ 상단 별도 층 → 사용자 수용 ④ `— 또는 —`로 하단 복귀 → **이미 거부당한 상태로 되돌림** → 사용자 불만. **최종: 상단 별도 층** |
| **없는 버그를 보고함** | "주사위 효과음이 음소거 설정을 안 읽는다"고 했으나 `useGamePlayRoll.ts:117,470`이 이미 읽고 있었다. grep을 `GamePlay.tsx`·`feedback/*.ts`로만 해서 168 리팩터링이 옮겨간 파일을 놓쳤다. 커밋 메시지에까지 적어서 리워드로 정정함 |
| **`baseline-ui`가 충돌한다고 과장** | 두 MUST 모두 조건절이 있고 프로젝트가 이미 충족하고 있었다. 그 과장 때문에 사용자가 유용한 스킬을 안 쓸 뻔함 |
| **번들 27.6kB를 과대평가** | 실제 시간으로 LTE 100ms. 게다가 라우트 스플리팅으로 순감이 됐다. 우려 자체가 과했음 |
| **캐러셀 회귀를 의심받았을 때** | 이웃 카드·순환·모바일 화살표는 **내가 건드린 적 없는** 원래 동작이었다. `git log develop..HEAD -- <file>`로 먼저 확인할 것 |

---

## 8. 새 세션 시작 프롬프트 (그대로 복사해서 쓸 것)

```
C:\Users\appel\Downloads\_ssafy\S15P11A406-169-ui-design-system 워크트리에서
이어서 작업한다. WORK.md를 먼저 읽고 그 문서의 규칙(§1)·함정(§2)·확정 결정(§6)·
반복 금지(§7)를 지켜라.

§5 체크리스트를 순서대로 진행한다. 5-1(디자인 판단 필요)은 반드시 ui-skills의
디자인 스킬을 받아 에이전트에 위임하고, 네가 값을 정하지 마라.
5-2(기능)는 바로 진행해도 된다.

작업할 때마다 WORK.md의 체크박스를 갱신하고, 커밋은 작게 나눠라.
승인은 필요한 것만 모아서 마지막에 한 번에 물어라.
```
