# 테스트 전략 — 단위 하네스·mock 백엔드·2단 E2E

> SSOT: [`../../vitest.config.ts`](../../vitest.config.ts), [`../../playwright.config.ts`](../../playwright.config.ts),
> [`../../playwright.visual.config.ts`](../../playwright.visual.config.ts),
> [`../../src/test/`](../../src/test/), [`../../e2e/support/`](../../e2e/support/)

## 전체 그림 — mock 백엔드가 **두 벌**인 이유

| 대상 | REST | WebSocket |
|---|---|---|
| dev 브라우저 · jsdom 단위 테스트 (**소스** 실행) | MSW (`src/mocks/restHandlers`) | `FakeRealtimeClient` + `realtimeScenarios` |
| E2E mock (**프로덕션 빌드** 실행) | `page.route` (`e2e/support/restMock`) | `page.routeWebSocket` (`e2e/support/fakeGameServer`) |

프로덕션 빌드는 `resolveMswMode()`의 `!import.meta.env.DEV` 가드로 MSW가 컴파일 아웃되므로
E2E는 자체 페이크가 필요하다. 두 벌을 잇는 다리가 `e2e/support/contract.ts` —
`wsEvents.ts`의 수동 미러로, 이름·형태를 원본과 똑같이 유지해 **계약이 바뀌면 이 파일이
먼저 깨지게** 한다.

## 단위 테스트 (Vitest + jsdom)

- `src/test/harness.tsx`의 `renderAppHarness` — **App.tsx와 같은 트리**
  (`InAppBrowserGate > RealtimeSync(FakeRealtimeClient) > VoiceProvider > RouterProvider`)를
  메모리 히스토리로 띄운다. 트리가 다르면 통합 테스트에서만 없는 요소가 생긴다.
- `src/test/setup.ts`의 핵심 결정:
  - `asyncUtilTimeout: 5000` + `testTimeout: 20000` — CI 러너는 같은 일에 로컬의 30배가
    걸린다. 대기 시간은 실패할 때만 소진되므로 통과 경로는 느려지지 않는다. testTimeout을
    asyncUtil보다 길게 둬야 밋밋한 "test timed out" 대신 RTL의 DOM 덤프 오류를 받는다.
  - **motion mock**: jsdom에는 WAAPI가 없어 `AnimatePresence` 퇴장이 끝나지 않는다 —
    "닫혔는가"를 검증할 수 없게 되므로 통과 컴포넌트로 mock하고 `initial={false}`를
    강제한다(마운트 프레임의 opacity: 0이 부하 걸린 CI에서만 터지는 flake의 원인이라
    단언을 하나씩 고치는 대신 틈 자체를 없앤다). Proxy에 키별 캐시를 둬 매 렌더 타입이
    바뀌어 3D 씬이 재마운트되는 것을 막는다.
  - MSW `onUnhandledRequest: 'error'` — 핸들러 없는 네트워크 호출은 하드 실패.
  - `threeStubs.ts`의 `FakeWebGLRenderer` — jsdom에 WebGL이 없어 렌더러가 "무엇을
    요구받았는지"만 기록하고 장면·카메라·물리는 실제로 돈다.
- `hookTimeout: 30000` — RAPIER wasm 초기화가 부하 시 10초를 넘긴다.

### 커버리지 정책 — 분모가 전부다

- **전체 `src`를 분모에 넣는다.** 테스트가 import한 파일만 세면 한 번도 실행되지 않은
  소스가 분모에서 빠진다 — 수치가 실제 안전망 크기를 말하려면 전체 기준이어야 한다.
- 제외는 각각 근거를 적는다: `mocks/`(제품 코드 아님), dev 전용 **UI만**(같은 폴더의
  motionLab 유틸은 테스트가 있어 분모에 남긴다), 그리고 `physics-dice/World.ts` —
  렌더 루프가 실제 시간을 재서 부하에 따라 분기 커버리지가 71~85%로 흔들리는 유일한
  파일이라, 두면 코드 변경 없이 CI가 랜덤 실패한다(테스트 47개는 그대로 돈다 — 빠지는
  것은 측정뿐).
- 임계값은 **래칫**: 실측(st 96.33 · br 91.94 · fn 96.63 · ln 98.40)에서 소폭 여유를 둔
  하한. 오르면 임계값도 올리고, 내려가는 변경은 CI가 막는다.

## mock 백엔드 (`src/mocks/`)

- 모드 3종: `mock`(DEV 기본) · `fallback`(실서버 우선, 미구현 endpoint만 mock —
  `serverFirstHandler`가 501/도메인 코드 없는 404를 "미구현"으로 판정) · `off`(prod).
- **점수는 canned가 아니라 계산이다** — 핸들러가 실제 `domain/scoring`을 불러 클라 로컬
  계산과 제출 결과가 어긋나지 않는다.
- `mockRoomState`(sessionStorage) — 새로고침 후에도 진행 중 스냅샷을 `room.join`에
  돌려줘 재접속 경로가 mock에서도 성립한다.
- 정체성은 실서버처럼 sessionToken으로 가른다 — 모르는 토큰을 creator로 떨어뜨리면
  대시보드가 플레이어 정체성을 받아 자기 턴이 된다.
- 시나리오: REST `success|delay|error`, WS `+ duplicate | out-of-order | reconnect` —
  중복·역순 메시지 내성이 테스트 가능하다.

## E2E (Playwright, 2단)

- `npm run test:e2e` — **mock 단**: 서버 없이 프로덕션 빌드(`vite preview` :4306)의 UI
  계약 검증. 13 스펙: smoke · landing · create/join · invalid-invite · lobby-realtime ·
  game-flow · participant-view · disconnect · reconnect(자동 재입장 금지 포함) ·
  auth-login · not-found · **narrow-width**(320px 강건성 — 스크린샷 대신 기하로 가로
  넘침을 숫자 판정, 넘친 요소 이름까지 짚는다).
- `npm run test:e2e:real` — **실서버 단**: `globalSetup`(`checkBackend`)이 백엔드 미기동을
  30개 타임아웃 대신 원인+복구 명령 한 문장으로 즉시 실패시킨다. 방 격리 원칙: 테스트마다
  자기 방을 새로 만들고 일회용으로 취급. 실측으로 발견한 계약 불일치(서버가 한글 닉네임
  400 거부, 중복 닉네임 200 허용)가 주석으로 남아 있다.
- 프로젝트 4종: Pixel 7 · iPhone 15 · **mobile-320**(320×568 — 지원 하한이 검증 밖에
  있었다; iPhone SE 프로필은 webkit 강제라 view transition 겹침에서 렌더러가 죽어 Pixel
  프로필을 리사이즈해 쓴다) · desktop-chrome(760/1024px 분기 마크업 실행).
- `useSimpleDiceRenderer` — reduced-motion을 강제해 3D 물리를 결정적 2D 폴백으로 바꾼다.
  물리 정착 시점에 의존하지 않는 검증.
- 셀렉터는 전부 role 기준 — 760/1024px에서 마크업이 갈려도 같은 코드로 통한다. 문구
  단언은 정규식(320px에서 잘리는 라벨이 mobile-320에서만 실패하는 것 방지).

## 시각 대조 (`npm run test:visual`)

**회귀 테스트가 아니라 대조 도구다.** E2E 스펙은 전부 동작 검증이라 "겉모습이 안
바뀌었다"를 담보할 수단이 없었다 — 디자인 시스템 작업이 알파를 사다리로 옮기면 색이
미세하게 달라지는데, 그것을 눈으로 볼 자리가 없다.

```bash
git switch main && npm run test:visual   # 기준 이미지 생성 (없으면 만들고 통과)
git switch <작업 브랜치> && npm run test:visual   # 달라진 섹션만 실패 + diff 이미지
npx playwright show-report               # 기대/실제/diff 3장 비교
```

- **baseline을 저장소에 넣지 않는다**(`.gitignore`). 폰트 렌더링이 기기마다 달라 남의
  기계에서 뜬 이미지는 전부 어긋나고, 지켜 줄 CI도 없다 — **프론트에는 CI 잡 자체가
  없다**(`.github/workflows/backend.yml`은 백엔드 경로만 본다. 구 Jenkins
  파이프라인은 삭제했고, 그것도 Playwright를 돌리지 않았다). 검증은 로컬 명령과
  Vercel 빌드가 전부다. 따라서 **한 기계 안의 before/after**로만 쓴다.
- 대상은 `/__dev/components` 카탈로그를 **섹션 단위**로. 페이지 한 장으로 찍지 않는
  이유는 물리 주사위 렌더러·음성 랩·마스코트 가이드가 매 프레임 달라서다 — 세 섹션은
  제외돼 있다.
- 프로덕션 빌드가 아니라 **vite dev 서버**를 띄운다. 카탈로그가 `import.meta.env.DEV`
  게이트 안에 있어 빌드 산출물에는 없다.
- 임계값은 **`threshold: 0` + `maxDiffPixels: 0`**, 재시도 0. `threshold`를 빼먹으면
  도구가 조용히 무력해진다 — 기본값 `0.2`는 픽셀 하나의 색 거리 허용치라 헤어라인
  알파 1%p(채널 3/255) 차이를 "같은 픽셀"로 세고, `maxDiffPixels: 0`이어도 통과한다.
  같은 기계에서는 렌더링이 비트 단위로 같아 0/0이 오탐을 내지 않는다.
- **카탈로그가 곧 커버리지다.** shared 프리미티브 17종 중 카탈로그에 있는 것만 보인다
  (`ConnectionBanner`·`ToastHost`·`Popover`·`LoadingOverlay` 등은 아직 없다).
  프리미티브를 고치는데 카탈로그에 없으면 먼저 등재한다.

## 그 외 품질 장치

- `npm run check:cycles` (dpdm) — `app → landing → room → yacht` 단방향 의존을 CI에서 강제.
- Biome(포맷+린트), TypeScript strict + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`.
- 실기기 smoke: 갤럭시 Chrome·iPhone Safari에서 센서 권한·감도·background 복귀·탭 폴백.
  `/__dev/motion`이 실기기 튜닝용으로 배포에도 열려 있다.
- 검증 최소화 원칙(관성적 전체 실행 금지)은 [`../../AGENTS.md`](../../AGENTS.md).
