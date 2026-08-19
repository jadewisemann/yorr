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

| 순위 | 남은 격차 | 곳 | 판정 (2026-08-18 재실측) |
|---|---|---|---|
| ~~1~~ | ~~하드코딩 색~~ | ~~78~~ | ✅ **완료** — 예외 6곳만 raw(전부 주석) |
| ~~2~~ | ~~생 `<button>`~~ | ~~93~~ | ✅ **판정 완료** — 재실측 59곳(93은 낡은 수). 게임 액션 버튼 9곳은 `PingPongButton`·`DuelButton`으로 흡수, 나머지 50곳은 전부 정당 갈래(분류는 design-system.md 규칙 1) |
| ~~3~~ | ~~간격 토큰화~~ | ~~965~~ | ✅ **전제가 틀렸다** — Tailwind v4가 이미 전 간격을 `calc(var(--spacing)×N)`으로 컴파일한다. "전체를 20% 촘촘하게"는 `--spacing` 한 줄이다. 변수를 우회하는 임의값은 26곳뿐이고 전부 safe-area·뷰포트 기하라 정당 |
| ~~4~~ | ~~타이포 토큰화~~ | ~~428~~ | ✅ **같은 판정** — 전 글자가 `var(--text-*)`로 컴파일된다. 스케일 1파일화는 이미 있다. 임의값 6곳은 디스플레이 숫자(404·워터마크·카운트다운) |
| ~~—~~ | ~~200줄 초과, 이유 주석 없음~~ | ~~10~~ | ✅ **완료** — 재실측 7개. `Arena` 915줄은 성격별 5조각으로 분할, `Popover`는 배치 산술을 추출, 나머지 5개는 각자 **정직한 유지 이유**를 주석으로(RealtimeSync는 이관 티켓과 함께 갈라야 diff가 안 묻힌다 등) |

`gap` 6단 정리(#16)는 3번의 **준비 단계였지 목적지가 아니다** — 288곳이 여전히
호출부에 리터럴로 박혀 있어 "전체를 20% 촘촘하게"는 아직 전수 수정이다. 얻은
것은 "다음 사람이 `gap-2.5`를 새로 만들지 않는다"까지다.

### 라이트 모드 — 끝났다 (2026-08-18)

색 회수 78곳 → 테마 층(`[data-theme="light"]`) → 토글·영속·프리페인트 → 대비 검증
→ 계정 다이얼로그 「화면 테마」 노출까지 완료. 결과는 문서에 반영했다 —
구조·규칙은 [design-system.md](docs/llmwiki/design-system.md)(테마 층·JS 색 읽기 규칙),
부팅 순서는 [app-shell.md](docs/llmwiki/app-shell.md), 과정 기록은
IMPLEMENTATION_NOTES.md 2026-08-18 항목들.

### 열린 결정 2건

- ~~**brand 톤이 두 값이다**~~ → **글자 쪽으로 확정했다 (2026-08-18).** `Badge`
  brand 톤의 글자를 `text-brand` → `text-brand-strong`으로 — LeveragePage가 이미
  쓰던 값이라 **글자 톤은 하나가 됐다**(다크에서 `#e53935`→`#ff4d48`로 밝아지는
  변화 수용, 대비는 4.71→6.08로 오히려 오른다). `brand-soft`가 아닌 이유: soft는
  다크에서 분홍(#ff8a86)까지 밀려 배지의 브랜드 정체성이 흐려진다. 테두리 차이
  (`border-brand/40` 대 `border-brand bg-brand/15`)는 컴포넌트 몫으로 남긴다 —
  같은 톤 이름 아래 강도가 다른 것은 규칙 위반이 아니다
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
