# PLANS — 진행 중 변경

> "시스템이 어떻게 동작하는가"는 [DESIGN.md](DESIGN.md), 계획이 끝나면 이
> 문서에서 지우고 결과를 설계 문서에 반영한다.

## 현재 상태: 와이어 계약 동결 🧊

백엔드 Java → JS 마이그레이션([backend/PLANS.md](../backend/PLANS.md))이 끝날
때까지 프론트엔드 프로덕션 코드는 변경하지 않는 것이 목표다. 특히
`src/realtime/wsEvents.ts`와 REST 사용부는 **계약 동결** 상태다

> **동결의 범위 (2026-08-16 해석).** 동결 대상은 **와이어 계약**이다 —
> `wsEvents.ts`와 `room/api/*`·`shared/api/*`의 사용부. 화면·스타일·공용
> 컴포넌트는 계약을 건드리지 않으므로 동결과 무관하다(아래 디자인 시스템 작업
> 5건이 그 선례다). 백엔드는 "이식 완료"지만 e2e:real·MySQL 통합이 미검증이라
> 동결을 아직 풀지 않는다
([backend ADR-0002](../backend/docs/adr/0002-strangler-wire-contract.md)).
문서·테스트·포트폴리오 작업은 동결과 무관하다.

## 대기 중인 이관 티켓 (동결 해제 후)

| 작업 | 내용 | 근거 |
|---|---|---|
| envelope 게임 무관화 | `wsEvents.ts → yacht/domain/*` 결합 해소 — 게임 무관 envelope + 게임별 payload로 분리 | DESIGN.md 경계 예외 1 |
| GameResult 콜백화 | `yacht/screens/GameResult.tsx → room/api/useGameApi` 직접 호출 제거 — `GamePage`가 콜백으로 내려준다 | DESIGN.md 경계 예외 2 |
| sys.reconnect 라우팅 (티켓 25) | 서버에 `sys.reconnect` 처리 추가 또는 이벤트를 계약에서 제거 — 현재는 보내면 조용히 버려져 `room.join` 재전송으로 우회 중 | IMPLEMENTATION_NOTES 2026-08-14 |

계약을 바꾸는 작업은 모두 백엔드와 함께 결정한다 — 시작할 때 이 문서에 계획을
구체화하고(목표·관련 설계·불변식·검증), 백엔드 PLANS.md와 상호 링크를 건다.

---

## 디자인 시스템 — 스타일 변경 대응력 확보 (진행 중)

> **목표는 라이트 모드다.** 테마를 추가할 수 있는 구조를 먼저 만드는 중이며,
> 라이트 모드 구현 자체는 아직 시작하지 않았다. 이 절은 어디까지 왔고 무엇이
> 남았는지를 기록한다. 끝나면 이 절을 지우고 결과를 DESIGN.md·
> [design-system.md](docs/llmwiki/design-system.md)에 반영한다.

### 왜 하는가 — 최초 진단 (2026-08-16 실측)

`src/` 전체 tsx 23,195줄 · `className` 1,124곳을 성격별로 세었다.

| 성격 | 인라인 등장 | 중앙 흡수층 |
|---|---|---|
| 색·테두리 | 1,537 | ✅ `tokens.css` 색 토큰 84개, 2계층 |
| 레이아웃·간격·크기·포지션 | **2,760** | ❌ 없음 |

**문제는 밀집도가 아니라 흡수층의 비대칭이었다.** 색은 이미 중앙화돼 팔레트
변경이 `--ds-*` 한 곳에서 끝나지만, 조합을 흡수하는 컴포넌트 층이 없어 배치
결정이 1,124곳에 흩어져 있었다. `design-system.md` 규칙 1이 이미 그 구조를
요구하는데(공통 프리미티브 → 얇은 래퍼로 분기, 선례 `GameChromeButton`)
프리미티브가 14개뿐이라 분기칠 몸통이 없었다.

### 끝난 것 (PR #13 · #14 · #15 · #16, 전부 main 병합)

프리미티브 4종 추가 — **#16을 뺀 셋은 겉모습 무변화**다.

| 프리미티브 | 사용 | 흡수한 결정 |
|---|---|---|
| `Alert` | 14곳 | tone 3종. **`role`을 톤이 정한다**(danger→alert, positive→status, neutral 없음) |
| `Badge` | 13곳 | tone 3종. 크기는 호출부 몫 |
| `Panel` | 33곳 | surface 3종 + `as`로 시맨틱 태그. 패딩 기본값 없음 |
| `GameCanvas` | 14곳 | `Screen.tsx`. 게임 캔버스 프레임. 배경색은 도메인 팔레트라 안 든다 |

문서에 굳힌 규칙 3개 — **컴포넌트보다 이쪽이 오래간다.**

1. **위계가 바뀌면 `variant`, 색만 바뀌면 `tone`** (DESIGN.md 원칙 8). 새 이름
   (`kind`·`type`·`level`)을 만들지 않는다
2. **행이면 `card`, 상자면 `panel`** (design-system.md 사다리 절). 라운드가
   panel 13 : card 14로 반반이었는데 갈리는 기준이 크기가 아니라 모양이었다 —
   card 14곳 중 10곳이 `px`/`py`만 쓰는 행이었다
3. **`gap`은 `1 · 1.5 · 2 · 3 · 4 · 6` 6단.** 사다리 밖이 필요하면 가장 가까운
   단, 동점이면 좁은 쪽(320px 하한에서 넓히면 넘칠 위험)

곁가지로 `biome.json`의 `lineEnding`을 `crlf` → `lf`로 고쳤다. 저장소에 CR이 든
파일이 0개인데 설정만 crlf여서 `npm run check`가 460개 에러로 죽어 있었다.

### 아직 안 된 것 — 여기가 다음 세션의 출발점

**총량 지표는 거의 안 움직였다**(배치 2,760 → 2,750). 프리미티브가 흡수한 건
74곳이고 나머지는 그대로다. 즉 **"컴포넌트 하나의 모양"은 바꾸기 쉬워졌지만
"전체의 리듬·테마·위계"는 여전히 전수 수정이다.**

| 순위 | 남은 격차 | 곳 | 이걸 하면 가능해지는 것 |
|---|---|---|---|
| **1** | **하드코딩 색** `white/N`·`black/N`·`text-white` | **78** | **라이트 모드** |
| 2 | 생 `<button>` | **93** | 버튼 위계 1파일화 |
| 3 | `gap` 리터럴 288 · `p*`/`m*` 677 → **토큰화**(`gap-md` 식) | 965 | 리듬 전체 1파일화 |
| 4 | `text-*` 타이포 | 428 | 스케일 1파일화 |
| — | **200줄 기준선 초과, 이유 주석 없음** — `Arena.tsx` 915줄 · `RealtimeSync.tsx` 358 · `GamePlay.tsx` 334 외 7개 | 10 | DESIGN.md 원칙 7 준수 |

`gap` 6단 정리(#16)는 3번의 **준비 단계였지 목적지가 아니다** — 288곳이 여전히
호출부에 리터럴로 박혀 있어 "전체를 20% 촘촘하게"는 아직 전수 수정이다. 얻은
것은 "다음 사람이 `gap-2.5`를 새로 만들지 않는다"까지다.

### 라이트 모드 로드맵 (1번이 8할)

현재 테마 전환 장치가 **하나도 없다** — `prefers-color-scheme`·`data-theme` 모두
부재, `:root` 고정. `index.html`의 `<meta name="theme-color">`도 `#08090a` 고정.

1. **하드코딩 색 회수 (78곳, 테스트 제외).** `design-system.md`가 이미 "눈대중
   `white/NN` 금지"라 적어 뒀는데 지켜지지 않았다. 2026-08-18 재실측:

   | 갈래 | 곳 | 실측 알파 (값×곳) | 갈 곳 |
   |---|---|---|---|
   | `border-white/N` | 22 | 8×2 · 12×5 · 15×8 · 18×1 · 20×4 · 22×1 · 28×1 | 헤어라인 3단 (`border` 10 / `border-raised` 14 / `border-strong` 18) |
   | `bg-white/N` | 19 | 4×1 · 6×4 · 8×8 · 10×1 · 12×1 · 15×1 · 20×1 · 24×2 | 표면 토큰 (`surface-veil` 6% 위로 단이 더 필요하다) |
   | `bg-black/N` | 10 | 35×2 · 45×3 · 55×1 · 65×2 · 72×2 | 스크림 사다리 — 현재 `--ds-color-scrim` 66% 한 단뿐이라 신설 |
   | `text-white`(+알파) | 17 | 민 14 · /4 · /35 · /70 | semantic (`content`군) |
   | `outline-white` · `stroke-white/35` | 5 | — | 포커스·아이콘 |
   | 순백 `bg-white` | 4 | — | **회수 대상 아님** — QR 정숙 구역 2곳(`InvitePopover`·`PartyDashboardPage`), 탁구공 1곳, `Button` secondary hover. 라이트에서도 흰색이어야 한다 |

   **라이트에서 순백 4곳을 뺀 74곳이 전부 깨진다** — 흰 배경에 `bg-white/8`은 안
   보인다. `border-white/28`(Button ghost)은 사다리 밖이지만 `design-system.md`가
   이미 이유를 적어 둔 선례다
2. **테마 층 신설.** `:root` 다크 유지 + `[data-theme="light"]` 오버라이드.
   색 토큰 84개 중 갈려야 할 것만. semantic 층(`@theme inline`)과 컴포넌트는
   손대지 않는다 — 2계층 구조가 이 저장소의 제일 큰 자산이다
3. **3D·canvas.** 재질 색이 CSS를 안 거친다. `pingpong/scene3d.ts`의
   `setClearColor`·`FogExp2`는 tokens.css와 **같은 값을 양쪽에 적어둔
   것**이고(tokens.css 주석), yacht의 `appearance.ts`는 `--ds-*`를 직접 읽는다.
   테마가 바뀌면 JS가 다시 읽어야 한다. hex가 박힌 파일: duel 6 · pingpong 3 ·
   yacht 2
4. **토글 + 영속.** `store.ts`(현재 theme 상태 없음) + `<meta theme-color>` 동기화

### 열린 결정 2건

- **brand 톤이 두 값이다.** `LeveragePage:87`은
  `border-brand bg-brand/15 text-brand-strong`, `PlayModeDialog:46`은
  `border-brand/40 text-brand`. `Badge`의 `brand`는 후자로 잡았고 `LeveragePage`는
  치환하지 않았다 — 합치면 한쪽 겉모습이 바뀐다
- **`gap-0.5` 되돌릴 자리.** 6단으로 좁히며 `0.5`(2px) → `1`(4px)로 올린 10곳은
  전부 **라벨+값 두 줄 묶음의 행간**이었다(`grid gap-0.5`·`flex flex-col gap-0.5`,
  AccountMenu·DuelController·ModeRow·TurnStatus 등 4개 도메인). 뜨게 느껴지면
  여기가 되돌릴 지점이다

### 손대지 않기로 한 것 (이유 있음)

- `Modal` → `Panel` — `motion.section`이라 모션 variants 배선이 통과하지 못한다
- `ReactionDock` → `Panel` — `bg-surface-overlay/95`로 표면 사다리에 없는 값
- `PlayModeDialog:42` · `MotionPermissionPanel:21` → `Alert` — 제목·버튼을 품은
  강조 패널이지 알림 한 문장이 아니다. `role="alert"`를 달면 정적 패널을
  스크린리더가 계속 읽는다. `Panel` 계열의 몫
- 남은 `h-svh` 10곳 → `GameCanvas` — `LobbyPage`·`AuthCallbackPage`·
  `LeveragePage`·`GameResult`·`PartyOpeningNotice`·dev 화면. 성격이 제각각이라
  각각 판단이 필요하다

### 검증 수단 — 메웠다 (2026-08-18)

`npm run test:visual`. 한 기계 안에서 main과 작업 브랜치의 `/__dev/components`를
섹션 단위로 찍어 대조한다. 사용법·제외 섹션은
[testing.md](docs/llmwiki/testing.md)「시각 대조」.

착수 전 세워 뒀던 전제 두 개가 실측에서 틀렸다.

- **"baseline은 Jenkins 환경에서 떠야 한다 — 아니면 CI가 영구히 빨개진다."** Jenkins
  프론트엔드 스테이지는 `check`·`typecheck`·`test`·`build`만 돌린다 — **Playwright를
  아예 실행하지 않는다**(`Jenkinsfile`, `archiveArtifacts`에 playwright-report 경로만
  남아 있어 오해하기 쉽다). 빨개질 CI가 없으니 이 제약도 없다. 대신 baseline을 지켜
  줄 CI도 없다는 뜻이라, **저장소에 넣지 않고** before/after 대조로만 쓴다.
- **"카탈로그 한 장이면 프리미티브 전체가 커버된다."** 실제로는 shared 17종 중
  7종이었다(`Alert`·`Badge`·`Button`·`Modal`·`Panel`·`TextField`·`Tooltip`).
  아래 색 회수가 건드리는 `GameChromeButton`·`BottomSheet` 두 종을 등재했고, 나머지
  8종(`ConnectionBanner`·`ToastHost`·`Popover`·`LoadingOverlay`·`Screen`·`Icon`·
  `AudioPopover`·`AudioStatusIcon`)은 그것을 고칠 때 등재한다.

카탈로그는 **페이지 한 장이 아니라 섹션 단위**로 찍는다 — 물리 주사위 렌더러·음성
랩·마스코트 가이드가 매 프레임 달라 한 장으로는 매번 diff가 난다.

### 작업 규약

- PR은 작게 — 지금까지 9~15파일, +90~210줄 수준으로 끊었다
- **실측 먼저.** 이 절의 모든 판단은 `grep` 집계에서 나왔다. 추정으로 잡았던
  "Alert 22곳"은 실제로 4곳이었다 — 세고 나서 만든다
- 새 프리미티브는 `/__dev/components` 카탈로그 등재 + `__tests__` +
  shared-ui.md 인벤토리 한 줄까지가 한 단위다
