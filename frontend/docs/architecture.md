# YORR 프론트엔드 아키텍처

이 문서는 프론트엔드 코드베이스가 **어떤 모양이고, 왜 그런 모양이 되었는지**를 설명합니다.
빠른 실행 방법과 폴더 트리는 [`../README.md`](../README.md)에, 각 도메인의 동작 상세는
[`llmwiki/`](llmwiki/index.md) 레퍼런스 위키에 있습니다.

## 큰 그림

YORR는 모바일 브라우저에서 돌아가는 실시간 멀티플레이 게임 플랫폼입니다. 프론트엔드의
역할은 세 가지로 요약됩니다.

1. **서버 상태를 화면으로** — 방·게임 상태의 최종 권위자는 서버입니다. 클라이언트는
   WebSocket 이벤트와 재접속 스냅샷을 받아 상태를 그립니다.
2. **센서를 게임 입력으로** — 휴대폰의 모션 센서(흔들기·스윙·휘두르기)를 판정해 게임
   이벤트로 바꿉니다. 원시 센서값은 서버로 보내지 않고, 판정된 이벤트만 보냅니다.
3. **연출은 로컬에서** — 3D 주사위 물리, 히어로 연출, 진동·소리 피드백처럼 "느낌"을
   만드는 것은 전부 클라이언트 몫입니다.

```text
Browser ── REST ──────────► Spring Boot  (방 생성·입장, 계정, 랭킹)
        ── WebSocket ─────► Spring Boot  (방·게임 상태 동기화 — 서버 권위)
        ── WebRTC ────────► 큰 화면      (파티 컨트롤러의 연출 신호. 안 붙으면 WebSocket)
```

## 디렉터리: 도메인 우선

`src/` 바로 아래는 `landing` · `room` · `yacht` 같은 **도메인**이고,
`screens` · `components` · `api` 같은 **레이어는 도메인 안에** 둡니다.

처음에는 반대(레이어 우선)였습니다. 그 구조에서는 야추 하나를 이해하려고 7개 폴더를
동시에 뒤져야 했고, `components/` 한 폴더에 랜딩 카드·야추 게임판·로비 패널·공용 버튼이
평평하게 섞여 있었습니다. 236개 파일을 옮겨 도메인 우선으로 재편한 뒤로는 **게임 하나를
추가하는 일이 폴더 하나를 만드는 일**이 되었습니다.

### 도메인 안 세그먼트

도메인 안에서는 필요한 세그먼트만 만들고, 파일 없이 미래를 위한 폴더를 만들지 않습니다.

| 세그먼트 | 책임 | 밖에서 import |
|---|---|---|
| `screens/` | 라우트가 그리는 화면 | 가능 |
| `components/` | 그 도메인 전용 컴포넌트 | 가능 |
| `domain/` | 순수 규칙·타입 (React·DOM을 모름) | 가능 |
| `api/` | REST 호출 | 가능 |
| `model/` | 상태·훅 | **불가** |
| `rendering/` | three.js · rapier | **불가** |

비공개 세그먼트(`model`, `rendering`)를 도메인 밖에서 import하면 Biome
(`noRestrictedImports`)이 막습니다. 밖에서 정말 필요하면 공개 입구 파일을 만듭니다 —
`yacht/prefetchPhysicsDice.ts`가 그 선례입니다.

배럴 파일(`index.ts`)은 쓰지 않습니다. 번들 비용은 +0.05%로 무시할 만했지만, 순환 의존
검사(`check:cycles`)가 배럴을 경유한 순환을 잡지 못하는 것이 결정적이었습니다.

## 의존 방향: 사용자 흐름을 따라 단방향

```text
app → landing → room → yacht (· pingpong · duel)
```

사용자가 앱을 쓰는 순서(부팅 → 랜딩 → 방 → 게임) 그대로 import 방향을 고정하고,
되돌아가는 import를 금지합니다. `auth` · `shared` · `realtime` · `games.ts` · `store.ts`는
경계 모듈이라 어느 도메인에서나 참조할 수 있습니다. 순환은 CI에서
`npm run check:cycles`(dpdm)가 막습니다.

추가 규칙 두 가지:

- `yacht/domain/`은 React·DOM·네트워크를 모릅니다. 순수 함수와 타입만 있어 테스트가
  가장 쉬운 층입니다.
- `yacht/rendering/`은 `screens` · `realtime` · `store`를 import하지 않습니다. 3D 연출은
  앱 상태를 직접 읽지 않고 파라미터로 받습니다.

알려진 경계 예외는 2건이고(와이어 계약의 야추 의존, 결과 화면의 room API 직접 호출),
각각 해소 방법이 티켓으로 잡혀 있습니다. 상세는
[`llmwiki/architecture.md`](llmwiki/architecture.md)에 있습니다.

## 상태 설계: 세 종류를 섞지 않기

상태를 출처 기준으로 세 종류로 나누고, 서로 다른 규칙을 적용합니다.

- **서버 권위 상태** — 방 phase, 참가자, 라운드, 주사위 값, 점수 등. WebSocket 이벤트나
  재접속 스냅샷**만** 이 상태를 바꿀 수 있고, React 컴포넌트가 직접 수정하지 않습니다.
- **로컬 UI 상태** — 편집 중인 킵 선택, 애니메이션, 센서 권한 등. 게임 입력 상태는
  `gameId`/`roundId`에 귀속시켜, 새 라운드나 스냅샷이 오면 작성 중이던 값을 폐기합니다.
- **파생 상태** — 남은 시간, 버튼 활성 여부, 후보 점수, 세션 phase. **계산하고 저장하지
  않습니다.** 저장하는 순간 원본과 어긋날 수 있기 때문입니다.

전역 store는 Zustand 하나(`src/store.ts`)뿐입니다. 세션·스냅샷·연결 상태·빠른 대전
대기·공지를 담고, localStorage 영속화는 액션의 부수효과로만 일어납니다.

## 실시간 통신: 계약 하나, 정책 한 곳

- **와이어 계약의 SSOT는 `src/realtime/wsEvents.ts`** 입니다. 백엔드(Java)는 이 파일을
  import할 수 없으므로 같은 타입 문자열과 필드로 DTO를 미러링합니다 — "이 .ts가 기준이고
  Java가 따라온다"가 팀 합의입니다.
- 전송 클라이언트(`realtimeClient.ts`)는 열기/닫기/JSON 인코딩만 하는 **정책 없는**
  클라이언트이고, 재연결·heartbeat·상태 반영 정책은 전부 `app/RealtimeSync.tsx` 한 곳에
  있습니다. 덕분에 전송만 가짜(`fakeRealtimeClient`)로 갈아끼우면 정책까지 통째로
  테스트할 수 있습니다.
- 상태 동기화는 diff가 아니라 **전체 스냅샷**(`state.sync`)입니다. 2~6인 규모에서는
  스냅샷이 단순하고, 재접속 복구와 같은 경로를 타게 됩니다.

연결·재접속·heartbeat의 상세는 [`llmwiki/realtime.md`](llmwiki/realtime.md),
방 텍스트 채팅은 [`llmwiki/chat.md`](llmwiki/chat.md)를 참고하세요.

## 스타일: 토큰 2계층

Tailwind CSS v4를 CSS-first `@theme`로 씁니다. 색·간격은 원시값(`bg-[#e53935]`) 대신
semantic 토큰(`bg-brand`)을 쓰고, 토큰은 2계층입니다 — `:root`의 원시값(`--ds-*`)을
`@theme`의 semantic 토큰이 alias합니다. 디자인이 바뀌면 원시값만 바꾸면 됩니다.

애니메이션 구현체는 두 개이고 경계가 있습니다: **장식·상태 강조(반복·한 번 튐)는 CSS
keyframes, 진입·퇴장·제스처는 Motion.** 상세는
[`llmwiki/design-system.md`](llmwiki/design-system.md)에 있습니다.

## 테스트: mock 백엔드 두 벌

| 대상 | REST | WebSocket |
|---|---|---|
| dev 브라우저 · 단위 테스트 (소스 실행) | MSW | `FakeRealtimeClient` |
| E2E (프로덕션 빌드 실행) | `page.route` | `page.routeWebSocket` |

프로덕션 빌드에서는 MSW가 컴파일 아웃되므로 E2E는 자체 페이크 서버를 씁니다. 두 벌이
어긋나지 않도록 `e2e/support/contract.ts`가 `wsEvents.ts`를 수동 미러링해서, 계약이
바뀌면 이 파일이 먼저 깨지게 되어 있습니다. 상세는
[`llmwiki/testing.md`](llmwiki/testing.md)를 참고하세요.

## 기술 선택과 미채택

확정 스택: React 19 · TanStack Router · Zustand · Vite · TypeScript strict
(`noUncheckedIndexedAccess` · `exactOptionalPropertyTypes`) · Biome · Tailwind CSS v4 ·
Three.js · Rapier · Motion · Vitest · Testing Library · MSW · Playwright.

검토했지만 **쓰지 않기로 한 것**도 기록합니다: TanStack Query(명령형 REST 위주라 캐시
가치가 낮음), Zod(runtime 검증 담당처 미정), ts-pattern, es-toolkit,
simple-peer/peerjs(WebRTC 음성 채팅이 텍스트 채팅으로 바뀌며 필요가 사라졌습니다 — [`llmwiki/chat.md`](llmwiki/chat.md)).

---

문서와 코드가 다르면 **항상 코드가 이깁니다.** 어긋난 문서를 발견하면 고치거나 지워
주세요.
