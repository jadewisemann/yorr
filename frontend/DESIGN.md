# YORR Frontend — 시스템 설계 (source of truth)

> 이 문서는 프론트엔드가 **어떻게 동작해야 하는가**의 정본이다. 코드는 How,
> 이 문서는 What / Why / Invariant를 말한다. 구현과 이 문서가 어긋나면
> [AGENTS.md](AGENTS.md)의 판정 절차를 따른다 — 조용히 코드를 따르지 않는다.
> (2026-08-14까지는 "코드가 이긴다" 규칙이었다. 전환 배경과 동기화 기준선은
> [ADR-0001](docs/adr/0001-design-doc-authority.md) 참고.)

## 핵심 원칙

1. **서버 권위(server authoritative).** 방·게임 상태의 최종 권위는 서버에 있다.
   클라이언트는 "의도"를 보내고 서버가 결과를 확정한다. 그래서 **서버가 판정·저장하는
   메시지는 반드시 WebSocket으로 간다** — 서버는 WebSocket만 말하므로, 피어 사이 직결
   (`realtime/controllerLink/`)에 태울 수 있는 것은 서버가 중계만 하는 연출 릴레이뿐이다
   ([controller-link.md](docs/llmwiki/controller-link.md)의 판정표).

   > **예외 1건 (파티 모드 탁구).** 파티 방에서는 **PLAYING 국면의 랠리 판정만** 대시보드가
   > 맡는다 — 큰 화면이 판정과 렌더를 같은 기기에서 해야 공 반전이 즉시 보이고, 한 방에
   > 모인 사람들이라 서버 판정이 지키던 신뢰가 필요 없다. 방 수명·시작·초기 상태·준비
   > 게이트·종료·전적은 그대로 서버가 소유한다. 경계는
   > [ADR-0003](docs/adr/0003-party-host-authority-pingpong.md).
   > **야추는 예외가 아니다** — 주사위 눈은 파티 모드에서도 서버가 굴린다.

   주사위 물리 시뮬레이션(three.js·rapier)은 **연출**이다 — `physics result != game result`.
   물리 결과를 서버로 보내거나 권위 상태에 반영하는 구현은 설계 위반이다.
2. **서버 권위 상태는 WS 이벤트·재접속 스냅샷만 변경한다.** phase·host·참가자·
   라운드·deadline·주사위·킵·굴림수·점수를 React 컴포넌트가 직접 수정하지
   않는다. 재접속은 증분 이벤트 재구성이 아니라 스냅샷이 기준점이다.
3. **상태는 세 부류로 나눈다.** ① 서버 권위 상태(위), ② 로컬 UI 상태 — 게임 입력
   draft는 `gameId`/`roundId`에 귀속되어 새 라운드·스냅샷이 오면 폐기한다,
   ③ 파생 상태 — 계산하고 저장하지 않는다. 전역 store는 Zustand 하나(`store.ts`),
   영속화는 액션의 부수효과로만.
4. **도메인 우선 구조.** `src/` 바로 아래는 도메인, 레이어는 도메인 안에 둔다.
   비공개 세그먼트(`model/`·`rendering/`)는 도메인 밖에서 import할 수 없다
   (biome `noRestrictedImports`가 강제). 배럴(`index.ts`) 금지 —
   `check:cycles`가 배럴 경유 순환을 못 잡는다.
5. **의존 방향은 단방향.** `app → landing → room → yacht(·pingpong·duel·davinci)`.
   `auth`·`shared`·`realtime`·`games.ts`·`store.ts`는 경계 모듈이라 어디서나
   참조한다. 되돌아가는 import 금지(`npm run check:cycles`가 강제). 경계를 넘는
   import만 `@/`를 쓴다.
6. **스타일은 토큰으로.** 색상·간격은 원시 값 대신 semantic token
   (`src/styles/tokens.css`), class 병합은 `shared/cn.ts`. 애니메이션은 이원화 —
   장식·상태 강조(반복·한 번 튐)는 CSS keyframes, 진입·퇴장·제스처는 `motion`.
   돌아가는 CSS 애니메이션을 motion으로 옮기지 않는다.
7. **컴포넌트는 렌더링만 한다.** 훅 호출 6개 초과 시 `model/` 훅으로 분리.
   화면·컴포넌트 파일 200줄 기준선, 넘길 때는 이유를 남긴다. 순수 모듈은 자기가
   생산하는 타입을 소비자에게서 빌려오지 않는다.
8. **`variant`와 `tone`은 다른 것이다.** 둘 다 정적 class map이지만 고르는 기준이
   갈린다 — `variant`는 **위계**가 바뀔 때, `tone`은 **색만** 바뀔 때 쓴다.
   판별법: 그 값을 바꿨을 때 크기·구조·역할이 함께 움직이면 `variant`,
   같은 상자에 색만 갈아입으면 `tone`. 한 컴포넌트가 둘 다 가질 수 있다.

   | prop | 쓰는 곳 | 왜 |
   |---|---|---|
   | `variant` | `Button`(primary/secondary/ghost/danger) · `StatusPanel` | "이 화면에서 몇 번째로 중요한가"라 `size`와 함께 붐빈다 |
   | `tone` | `Alert` · `GameChromeButton` · pingpong `Score` · `InAppBrowserGate` | 구조·크기 동일, 의미색만 다르다 |

   새 이름(`kind`·`type`·`level` …)을 만들지 않는다. 둘로 부족해 보이면 대개
   컴포넌트가 두 개여야 하는 것이다.

## 코드가 정본인 것들 (문서 우위의 예외)

아래 파일들은 기계가 소비하는 계약이라 **코드 자체가 정본**이다. 문서는 이들을
서술만 하며, 어긋나면 문서를 고친다.

| 파일 | 계약 |
|---|---|
| `src/realtime/wsEvents.ts` | WebSocket 와이어 계약 (프로토콜 버전 1) — 백엔드도 이 파일을 정본으로 본다 |
| `src/games.ts` | 게임 카탈로그 |
| `src/yacht/domain/scoring.ts` | 야추 점수 규칙 |
| `src/styles/tokens.css` | 디자인 토큰 |

> ⚠️ **와이어 계약 동결 중.** 백엔드 Java → JS 마이그레이션이 끝날 때까지
> `wsEvents.ts`와 REST 사용부를 바꾸지 않는다
> ([backend ADR-0002](../backend/docs/adr/0002-strangler-wire-contract.md), [PLANS.md](PLANS.md)).
> 지금까지 동결을 깬 것은 다섯 건이고 모두 PLANS.md에 근거가 있다 — 연습 방 시계(넓히기),
> 음성 채팅 → 텍스트 채팅(교체), 컨트롤러 링크 시그널링(넓히기), 파티 탁구 호스트
> 판정(넓히기), 다빈치 코드 추가(넓히기).

## 코드 구조

| 폴더 | 책임 |
|---|---|
| `app/` | 라우터·전역 provider·부팅. 개발 전용 화면은 `app/dev/` |
| `landing/` | 랜딩 화면·히어로 연출 |
| `auth/` | 소셜 로그인·세션 |
| `room/` | 방 생성·입장·로비, 게임을 띄우는 껍데기(`screens/GamePage`) |
| `yacht/` · `pingpong/` · `duel/` · `davinci/` | 게임 구현 전부 |
| `shared/` | 프리미티브 UI·공용 훅·REST client·`cn` |
| `realtime/` | WS 와이어 계약(`wsEvents.ts`)과 연결 client. P2P 직결은 `controllerLink/` |
| `mocks/` · `test/` · `styles/` | MSW·테스트 하네스·디자인 토큰 |

도메인 안 세그먼트: `screens/`·`components/`·`domain/`·`api/`(공개),
`model/`·`rendering/`(비공개). 실제 파일 없이 미래를 위한 폴더를 만들지 않는다.
테스트는 소스와 같은 폴더의 `__tests__/`. 컴포넌트 조각은 여러 부모가 쓰면 도메인
공용 `components/`, 한 부모만 쓰면 `components/<부모>/`.

구조의 근거(왜 도메인 우선인가, 측정값)는
[docs/llmwiki/architecture.md](docs/llmwiki/architecture.md)에 있다.

**게임을 추가할 때** 손댈 곳 세 군데: `src/games.ts` 항목 추가 → `src/<게임>/` 구현
→ `room/screens/GamePage` 분기.

## 알려진 경계 예외 2건 (둘 다 이관 티켓 있음 — [PLANS.md](PLANS.md))

- `realtime/wsEvents.ts → yacht/domain/*` — 와이어 계약 자체가 야추 모양이다.
  게임 무관 envelope로 가르는 것은 계약 변경이라 마이그레이션 동결 해제 후에만.
- `yacht/screens/GameResult.tsx → room/api/useGameApi` — 결과 화면이 "대기실로
  돌아가기"를 직접 호출. `GamePage`가 콜백으로 내리면 사라진다.

## 하위 시스템 문서 지도

`docs/llmwiki/`가 하위 시스템 설계 문서 층이다(백엔드의 `docs/design/`에 대응).
필요한 페이지만 골라 읽는다. 페이지마다 SSOT 코드 경로가 달려 있다.

| 문서 | 이럴 때 읽는다 |
|---|---|
| [product.md](docs/llmwiki/product.md) | 제품 범위·게임 목록·유저 플로우·안전장치 |
| [architecture.md](docs/llmwiki/architecture.md) | 구조·의존 방향·상태 설계의 근거와 상세 |
| [app-shell.md](docs/llmwiki/app-shell.md) | 부팅·라우트 표·코드 스플리팅·View Transitions·dev 화면 |
| [realtime.md](docs/llmwiki/realtime.md) | WS 계약·연결/재연결·heartbeat·스냅샷 병합 리듀서 |
| [chat.md](docs/llmwiki/chat.md) | 방 텍스트 채팅 — 중계 계약·provider 배치·안 읽은 수 |
| [controller-link.md](docs/llmwiki/controller-link.md) | 파티 폰↔큰 화면 WebRTC DataChannel — 연출 릴레이 직결·폴백·STUN만 |
| [room-and-session.md](docs/llmwiki/room-and-session.md) | 세션 FSM·저장/복구·방 수명주기·빠른 대전·파티 모드 |
| [rest-api.md](docs/llmwiki/rest-api.md) | 프론트가 호출하는 REST 엔드포인트 전체 |
| [landing.md](docs/llmwiki/landing.md) | 히어로 캐러셀·모드 선택·랭킹 티커·히어로 3D |
| [auth.md](docs/llmwiki/auth.md) | 카카오·구글 로그인·세션 저장·게스트 정책·닉네임 |
| [yacht.md](docs/llmwiki/yacht.md) | 야추 규칙·턴 리듀서·화면 합성·튜토리얼/레버리지 |
| [dice-physics.md](docs/llmwiki/dice-physics.md) | 3D 주사위 — 예측 시뮬·서버 값 리맵·재생 파이프라인 |
| [motion-input.md](docs/llmwiki/motion-input.md) | 모션 센서 제스처 파이프라인·useSwing·피드백 |
| [pingpong.md](docs/llmwiki/pingpong.md) | 탁구 — 기기 분기·지연 보상·코트 SSOT·AI 모드 |
| [duel.md](docs/llmwiki/duel.md) | 석양이 진다 — 반응 측정·입력 밸런스·착탄 예측 |
| [davinci.md](docs/llmwiki/davinci.md) | 다빈치 코드 — 시점별 상태·선택 draft·타일 표기 |
| [shared-ui.md](docs/llmwiki/shared-ui.md) | 프리미티브 컴포넌트·훅·REST 클라이언트 |
| [design-system.md](docs/llmwiki/design-system.md) | 토큰 2계층·cn 병합·레시피·모션 경계 |
| [testing.md](docs/llmwiki/testing.md) | 단위 하네스·mock 백엔드 2벌·2단 E2E·커버리지 래칫 |
| [code-rationale.md](docs/llmwiki/code-rationale.md) | 실측값·실패한 대안·함정 — 값을 바꾸거나 "단순화"하기 전에 심볼을 먼저 찾는다 |

## 문서 작성 규약

- 한 파일 = 한 주제. 도메인 페이지는 파일 지도 → 핵심 설계 결정 → 불변식 순서.
- **"왜"를 남긴다.** 수치·정책에는 근거(실측 버그, 티켓 번호)를 붙인다. 코드
  주석에 이미 있는 근거는 요약 + 경로 참조로 충분하다.
- 새 문서는 위 지도에 한 줄을 추가한다. **지도에 없는 문서는 없는 것과 같다.**
- 결정의 배경("왜 이렇게 안 했는가")은 `docs/adr/`에 쓴다.
