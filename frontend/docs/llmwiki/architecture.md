# 아키텍처 — 구조·의존 방향·상태 설계·스택

> 디렉터리 규칙의 SSOT는 [`../../DESIGN.md`](../../DESIGN.md)의 「핵심 원칙」·「코드 구조」.
> 이 문서는 그 규칙의 근거와 실제 내용을 설명한다.

## 도메인 우선 구조

`src/` 바로 아래는 **도메인**이고 레이어(`screens`·`components`·`api`…)는 도메인 안에 둔다.

| 폴더 | 책임 | 상세 문서 |
|---|---|---|
| `app/` | 라우터·전역 provider·부팅·dev 화면 | [app-shell.md](./app-shell.md) |
| `landing/` | 랜딩·히어로 연출 | [landing.md](./landing.md) |
| `auth/` | 소셜 로그인·세션 | [auth.md](./auth.md) |
| `room/` | 방 생성·입장·로비 + 게임을 띄우는 껍데기(`GamePage`) | [room-and-session.md](./room-and-session.md) |
| `yacht/` · `pingpong/` · `duel/` | 게임 구현 전부 | [yacht.md](./yacht.md) · [pingpong.md](./pingpong.md) · [duel.md](./duel.md) |
| `shared/` | 프리미티브 UI·공용 훅·REST client·`cn` | [shared-ui.md](./shared-ui.md) |
| `realtime/` | WS wire contract(SSOT)와 연결 client · 방 채팅 | [realtime.md](./realtime.md) · [chat.md](./chat.md) |
| `mocks/` · `test/` · `styles/` | MSW·테스트 하네스·디자인 토큰 | [testing.md](./testing.md) · [design-system.md](./design-system.md) |
| `games.ts` · `store.ts` | 게임 카탈로그 SSOT · 전역 상태 | |

**왜 도메인 우선인가**: 이전 레이어 우선 구조에서는 야추 하나를 이해하려고 7개 폴더와
`src/` 루트(19개 파일 산재)를 동시에 뒤져야 했고, `components/` 한 폴더에 랜딩 카드·야추
게임판·로비 패널·공용 버튼이 평평하게 섞여 있었다. 도메인 우선이면 게임 추가 = 폴더 하나.
(236개 파일을 옮긴 재편)

테스트는 소스와 같은 폴더의 `__tests__/`에 둔다 — co-location은 폴더를 열면 절반이
`*.test.tsx`라 무엇이 있는지 읽히지 않았다.

### 도메인 안 세그먼트

도메인 안에서는 필요한 세그먼트만 만든다. 실제 파일 없이 미래를 위한 폴더를 만들지 않는다.

| 세그먼트 | 책임 | 공개 |
|---|---|---|
| `screens/` | 라우트가 그리는 화면 | 공개 |
| `components/` | 그 도메인 전용 컴포넌트 | 공개 |
| `domain/` | 순수 규칙·타입 (React·DOM 모름) | 공개 |
| `api/` | REST | 공개 |
| `model/` | 상태·훅 | **비공개** |
| `rendering/` | three.js·rapier | **비공개** |

- **비공개 세그먼트는 도메인 밖에서 import할 수 없다** — `biome.json`의
  `noRestrictedImports`가 막는다(duel·landing·pingpong·yacht). 밖에서 필요하면 공개
  입구를 만든다(선례: `yacht/prefetchPhysicsDice.ts`).
- **배럴(`index.ts`) 금지** — 번들 비용은 +0.05%로 무시할 만하지만 `check:cycles`가
  배럴 경유 순환을 **못 잡는다**(측정 근거는 `.dev.md` 1.6).
- 컴포넌트 조각의 자리: 여러 부모가 쓰면 도메인 공용 `components/`, 한 부모만 쓰면
  `components/<부모>/` 폴더.
- 순수 모듈은 자기가 생산하는 타입을 소비자에게서 빌려오지 않는다
  (선례: `duel/domain/fighter.ts`, `pingpong/domain/frameState.ts`).
- **컴포넌트는 렌더링만 한다** — 훅 호출이 6개를 넘으면 `model/`의 훅으로 분리.
  화면·컴포넌트 파일은 200줄 기준선, 넘길 때는 이유를 남긴다.

## 의존 방향 — 단방향, CI 강제

```text
app → landing → room → yacht(·pingpong·duel)
```

`auth`·`shared`·`realtime`·`games.ts`·`store.ts`는 경계 모듈이라 어디서나 참조한다.
되돌아가는 import 금지. `yacht/domain/`은 React·DOM·네트워크를 모르고,
`yacht/rendering/`은 `screens`·`realtime`·`store`를 import하지 않는다.
**`npm run check:cycles`(dpdm)가 순환을 CI에서 막는다.**

경계를 넘는 import만 `@/`를 쓴다 — `@/`가 보이면 경계라는 뜻이다.

### 알려진 경계 예외 2건 (둘 다 티켓 있음, 근거는 파일 주석)

- `realtime/wsEvents.ts → yacht/domain/*` — **와이어 계약 자체가 야추 모양이다.** 게임을
  추가하려면 게임 무관 envelope와 게임별 payload로 갈라야 한다. 게임 추가를 실제로 막는
  것은 폴더 구조가 아니라 이 프로토콜이다. (탁구·석양 상태가 경계에서 캐스팅되는 이유)
- `yacht/screens/GameResult.tsx → room/api/useGameApi` — 결과 화면이 "대기실로 돌아가기"를
  직접 호출. `GamePage`가 콜백으로 내리면 사라진다.

## 게임을 추가할 때 — 손댈 곳 세 군데

1. `src/games.ts`에 항목 추가 (`live: false`면 랜딩에서 "준비 중")
2. `src/<게임>/` 구현
3. `room/screens/GamePage`에서 분기 — 진행·결과 화면을 스스로 드는 게임(탁구·석양)은
   `moduleScreens`에 lazy 짝으로 등록, 야추만 방 진행 REST(`useGame`)를 함께 쓴다

## 상태 설계

- **서버 권위 상태**: 방 phase·host·참가자·라운드·deadline·주사위·킵·굴림수·점수 —
  WS 이벤트나 재접속 스냅샷만 변경한다. React 컴포넌트가 직접 수정하지 않는다.
- **로컬 UI 상태**: 편집 중 킵 마스크·선택 카테고리·애니메이션·센서 권한. 게임 입력
  상태는 `gameId`/`roundId`에 귀속 — 새 라운드나 스냅샷이 오면 draft를 폐기한다.
- **파생 상태**: 남은 시간·버튼 활성·후보 점수·세션 phase — 계산하고 저장하지 않는다.
  세션 FSM이 대표 사례([room-and-session.md](./room-and-session.md)).
- 전역 store는 Zustand 하나(`store.ts`) — 세션·스냅샷·연결 상태·빠른 대전 대기·공지.
  영속화는 액션의 부수효과로만.

## 확정 스택

React 19 · TanStack Router · Zustand · Vite · TypeScript strict
(`noUncheckedIndexedAccess`·`exactOptionalPropertyTypes`) · Biome · Tailwind CSS v4 ·
Three.js · `@dimforge/rapier3d-compat` · motion · qrcode.react · Vitest · Testing Library ·
MSW · Playwright.

**검토 후 미채택** (사용처 0 확인): TanStack Query(명령형 REST 위주라 캐시 가치 낮음),
Zod(runtime 검증 담당처 미정), ts-pattern, es-toolkit. WebRTC 라이브러리
(simple-peer·peerjs)는 음성 채팅과 함께 사라졌다 — 채팅은 WS 하나로 끝난다.
