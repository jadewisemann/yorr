# TASK — 품질 게이트 도입과 기준선 정리

> **이 문서는 세션을 넘겨 작업을 이어가기 위한 인수인계다.**
> 마지막 갱신: 2026-10-22
> 브랜치: `refactor/simplify-duplication`
> 기준 브랜치: `refactor/loc-token-limits` (`2a92cc5`) — **`main`이 아니다**

---

## 1. 현재 상태 (실측, 2026-10-22)

작업 트리는 **깨끗하고** 모든 게이트가 통과한다. 14개 커밋이 쌓여 있다.

| 검증 | 결과 |
|---|---|
| `npm run check:quality` | 통과 — 파일 486 · 함수 1812 · 기준선 위반 130건 · **신규 0건** |
| `npm run check:tokens` | 통과 |
| `npm run check:loc` | 통과 |
| `npm run test:quality` | 29개 통과 |
| 백엔드 `vitest run` | 113 파일 · **1333개 통과** |
| 백엔드 `tsc --noEmit` | 통과 |
| 프론트 `tsc -b` | 통과 |
| 프론트 `npm test` | 155 파일 · **1194개 통과** |
| 양쪽 `biome check` | 통과 (프론트 경고 2건은 기존 `trajectory.ts` non-null assertion) |

### 커밋 (오래된 것부터)

```
cb088ff  refactor: 게임 모듈·헤더·sleep·glob 중복을 걷어낸다
b53dca7  test: SQLite 하네스 기법을 순수 계산·상태 저장소에 적용한다
26c4291  chore: 결정론적 코드 품질 게이트를 켠다
a133c7b  refactor: 죽은 export를 걷어내고 복잡도 위반을 줄인다
ada14d0  refactor: 서버 조립을 관심사별로 나눠 createServer를 100줄 아래로
52431eb  refactor: 탁구 3D 테이블과 히어로 캐러셀 드래그를 떼어낸다
0a8097b  refactor: 라우트 핸들러와 봇 탐색을 이름 있는 함수로 나눈다
e98fa90  refactor: 실시간 연결과 메시지 리듀서를 나눈다
5788a9e  refactor: 게이트에서 개발 화면을 빼고 인프라 중첩을 푼다
a610566  refactor: 점수판·레이아웃 입력을 묶고 조회 조립을 나눈다
f7c3791  refactor: 스윙 판정과 링크 시작을 순수 함수로 뺀다
87afa4d  refactor: 서버 조립과 방 입장 검증을 단계별 함수로 나눈다
2e20689  refactor: 결투 아레나의 좌우 대칭 구획을 나눈다
```

> 커밋 14개 = 위 13개 + 기준 브랜치 위에 있던 `2a92cc5`.

---

## 2. 기준선 위반 130건의 정확한 내역

**주의: 과거 보고에서 할스테드를 "0건"이라고 잘못 적었다.** grep 패턴이
`^halstead`였는데 실제 라벨은 `halsteadDifficulty`라 잡히지 않았다. 아래가 정본이다.

```
functionLines        58건  (상한 80줄)
halsteadDifficulty   28건  (상한 80)
nesting              17건  (상한 4)
cyclomatic           15건  (상한 22)
parameters           12건  (상한 5)
duplicateBlocks       0건
deadExports           0건
```

### 시작점 대비

| 지표 | 시작(2026-10-21) | 현재 | 감소 |
|---|---|---|---|
| 기준선 위반 | 203 | **130** | -73 (-36%) |
| functionLines | 72 | 58 | -14 |
| parameters | 40 | 12 | **-28** |
| nesting | 29 | 17 | -12 |
| cyclomatic | 22 | 15 | -7 |
| halsteadDifficulty | 29 | 28 | -1 |
| duplicate | 0 | 0 | — |
| deadExports | 11 | **0** | -11 |

**완전 해소**: 중복 코드 0, 죽은 export 0.
**거의 그대로**: 할스테드(29→28) — 손대지 않았다.

---

## 3. 남은 130건의 성격과 권장 방향

### 상위 위반 (실측)

**functionLines**
```
backend/src/composition/rounds.ts:99   assembleRoundWiring   116
backend/src/server.ts:73               createServer          126
frontend/src/mocks/restHandlers.ts:30  createRestHandlers    218
frontend/src/mocks/realtimeScenarios.ts:36 createRealtimeFixture 198
frontend/src/landing/screens/EntryPage.tsx:32 EntryPage        169
frontend/src/landing/model/useEntryPage.tsx:17 useEntryPage    159
frontend/src/pingpong/rendering/scene3d.ts:58 createScene      356
frontend/src/landing/model/useHeroCarousel.ts:28 useHeroCarousel 136
frontend/src/pingpong/model/usePingPongGame.ts:21 usePingPongGame 135
frontend/src/duel/screens/DuelGame.tsx:21 DuelGame             124
frontend/src/duel/components/Arena/scenery.tsx:31 Wasteland    119
frontend/src/duel/model/useDuelGame.ts:77 useDuelGame          115
```
나머지 46건은 80~115줄 사이.

**halsteadDifficulty** (파일 단위)
```
backend/src/infra/redisCore.ts        167
backend/src/room/scripts.ts           129
backend/src/game/round/roundState.ts  118
backend/src/game/davinci/davinciGameService.ts 110
```
> 이 지표는 **파일이 클수록 무조건 올라간다**(토큰 근사). 함수를 쪼개도 파일이
> 그대로면 줄지 않는다 — 실제로 분리 후 오히려 오른 경우가 있었다. 손대려면
> **파일을 나눠야** 한다.

**cyclomatic**
```
frontend/src/yacht/model/useGamePlayRoll.ts  useGamePlayRoll  59
frontend/src/mocks/restHandlers.ts           createRestHandlers 51
frontend/src/yacht/components/ScoreSheet.tsx  ScoreSheet       47
frontend/src/pingpong/rendering/scene3d.ts   createScene       35
```

**nesting**
```
frontend/src/mocks/realtimeScenarios.ts  createRealtimeFixture 7
frontend/src/room/components/QuickMatchOverlay.tsx QuickMatchOverlay 6
frontend/src/yacht/domain/localGame.ts   createLocalYachtClient 6
```

### 왜 여기서 멈췄나

남은 것은 **거의 전부 큰 JSX 또는 3D 씬 함수**다. 다음 세 가지 이유로 위험 대비
실익이 줄었다.

1. **JSX 구획 분할은 props 타입을 여러 개 끌고 온다.** `DuelGame`(124줄)을 실제로
   쪼개다가 `DuelGameProps`·`MyShot`·`DuelInputSource`·`SwingPermission`·`RefObject`
   를 새로 import해야 하는 상태가 되어 **원복**했다.
2. **게이트 통과를 위해 타입을 느슨하게 만들면 본말전도다.** `useDavinciGame`(92줄)의
   전송 보일러플레이트를 제네릭 헬퍼로 묶으려다 `as never` 캐스팅이 필요해져
   **원복**했다. 그 커밋은 남기지 않았다.
3. **함수를 쪼개도 파일 할스테드는 안 줄어든다.** `assembleRoundWiring`(116)을
   `assembleBotWiring`(89)으로 빼자 이동만 하고 위반 수는 그대로였다(원복).

### 이어서 한다면 — 권장 순서

**A. 게이트에 JSX/씬 예외를 넣는 방향 (권장)**
"한 화면 = 한 컴포넌트"가 정당한 설계인 경우가 많다. `tools/check-code-quality.mjs`의
`isProduction`에 예외를 더하거나, `functionLines`를 JSX 파일에만 120~150으로
완화하는 옵션을 추가한다. **근거를 코드 주석과 QUALITY.md에 남길 것.**
대상이 되는 위반은 functionLines 58 + cyclomatic 일부 + nesting 일부다.

**B. 실제로 값어치 있는 것만 개별 처리**
- `backend/src/infra/redisCore.ts` (할스테드 167) — Lua 대체 구현이 한 파일에 모여
  있다. 명령별로 나누면 실제로 읽기 좋아진다.
- `frontend/src/mocks/restHandlers.ts` (218줄, 사이클로매틱 51) — 목 서버라
  엔드포인트별로 나누기 쉽고 위험이 낮다.
- `frontend/src/yacht/model/useGamePlayRoll.ts` (사이클로매틱 59) — 실제 게임 로직이라
  가치가 높지만 테스트가 두껍다(안전망 있음).

**C. 여기서 PR (가장 안전)**
현 상태는 모든 게이트가 초록이고 신규 위반 0이다. `Squash and merge`로 PR을 내고,
남은 130건은 별도 티켓으로 쪼개는 편이 리뷰하기 좋다.

---

## 4. 이번 작업에서 만든 것 (다음 사람이 알아야 할 것)

### 게이트
- **`tools/check-code-quality.mjs`** — Biome이 못 재는 지표를 소스 스캔으로 잰다.
  사이클로매틱 · 할스테드 · 함수 길이 · 매개변수 · 중첩 · 파일 간 중복 · 죽은 export.
- **`tools/qualityScanner.mjs`** — 순수 계산부(테스트 가능하게 분리).
- **`tools/quality-baseline.json`** — 위반을 `파일\0규칙\0이름`으로 고정한 장부.
- **`tools/check-code-quality.test.mjs`** + **`tools/qualityScanner.test.mjs`** — 29개.
  스캐너를 무력화하는 변이 시험으로 테스트가 실제로 빨개지는 것을 확인했다.
- `npm run check:quality` · `check:quality:report` · `test:quality`
- `.githooks/pre-commit`과 `.github/workflows/quality.yml`의 `code-quality` 잡에 배선.

### 게이트의 중요한 한계 (문서화됨)
- **파서가 아니라 토큰 스캐너**다. 함수 경계를 "선언 헤더 + 중괄호 균형"으로 찾는다.
  정규식으로 표현되지 않는 문법에서는 경계를 놓칠 수 있다.
- **할스테드는 파일 단위**다. 함수를 쪼개도 파일이 그대로면 안 줄어든다.
- **하드코딩을 피하려고 `--write-baseline`이 늘어난 위반을 나열**한다. PR diff의
  기준선 변경은 반드시 리뷰해야 한다.
- `ls-files --cached --others`로 **아직 add 안 한 새 파일**까지 본다. 이걸 빠뜨리면
  작업 중인 파일이 게이트를 통째로 빠져나간다(실제로 겪고 고쳤다).

### 다른 변경
- Biome `noExcessiveCognitiveComplexity`: `warn` → **`error`/22** (양쪽 패키지).
  QUALITY.md 2단계(복잡도 3종) 중 인지 복잡도 담당.
- `tools/check-loc-ratchet.mjs`: 자체 glob 변환기 → `node:path` `matchesGlob`.
  957개 파일 × glob 5종으로 양쪽 판정이 같음을 확인하고 교체.
- `tools/check-file-tokens.mjs`: `tools/quality-baseline.json`을 검사 제외(생성 장부).

### 테스트 보강
- SQLite 기법을 순수 계산·상태 저장소에 적용:
  - 경계값 — `pingPongCourtMath`(26), `davinciTurnFlow.placeDrawn`
  - 전수 대조 — `davinciTurnFlow`의 손패 × 더미 조합 전부
  - 표 기반 — `yacht/payloads`의 관용 규칙 전 조합
- `redisDavinciStateStore.test.ts` **신규** — 결투·탁구에는 있는 계약 테스트가
  다빈치에 아예 없었다.
- `advanceSwing` 테스트 5개(스윙 판정), `decideDraw` 테스트 4개(뽑기 판정).

---

## 5. 알아둘 함정 (이번에 겪은 것)

1. **브랜치 기준을 잘못 잡았다.** 처음에 `main`에서 땄는데, 작업 중이던
   `refactor/loc-token-limits`(10개 커밋)가 기준이어야 했다. 그대로 진행했으면
   커밋 10개가 사라진 상태에서 작업할 뻔했다. `git branch -avv`로 먼저 확인할 것.
2. **`token-baseline.json`은 늘릴 때 반드시 리뷰 대상이다.** 이번에 문서 3개를
   올렸다(`game-modules.md`, `IMPLEMENTATION_NOTES.md` ×2). `--write-baseline`이
   올라간 값을 출력한다.
3. **문서 토큰 상한(5,000)이 빡빡하다.** `QUALITY.md`는 8,125에서 8,122로 맞추느라
   여러 번 줄여야 했다. 새 절을 추가할 때는 같은 양을 덜어내야 한다.
4. **`app/dev/*`는 게이트 대상에서 제외했다.** 프로덕션 번들에도 커버리지에도
   들어가지 않고, 조작 패널을 일부러 한 파일에 모은 실험 도구다.
5. **`biome check --write`가 `biome.json`을 재포맷한다.** python `json.dump`로
   고치면 파일이 부풀어 diff가 지저분해진다. 손으로 최소 수정할 것.

---

## 6. 다음 세션 시작 절차

```bash
cd /home/ubuntu/code/yorr

# 1. 상태 확인 (깨끗해야 한다)
git status
git branch --show-current        # refactor/simplify-duplication
git log --oneline -5

# 2. 게이트가 정말 초록인지 확인
npm run check:quality            # "기준선 위반 130건(신규 0건)"
npm run check:tokens
npm run check:loc
npm run test:quality             # 29 passed

# 3. 남은 위반 보기
npm run check:quality:report

# 4. 코드가 바뀐 뒤 기준선 갱신이 필요하면 (리뷰 대상)
node tools/check-code-quality.mjs --write-baseline
```

### 작업을 이어갈 때 지킬 것
- **게이트를 통과시키려고 타입을 느슨하게 만들지 않는다.** `as never`·`as unknown as`
  로 통과시키는 순간 게이트가 거짓말을 한다.
- **위반이 이동만 하는 분리는 하지 않는다.** 함수를 빼서 새 함수가 위반이 되면
  순이득이 0이다.
- **한 커밋 = 한 가지 정리.** 지금까지 그렇게 해 왔고, 되돌리기가 쉬웠다.
- 커밋 후 `node tools/check-code-quality.mjs --write-baseline`으로 기준선을 줄여
  두는 것을 잊지 않는다(안 하면 다음 사람이 "사라진 위반"을 보게 된다).
- push·PR은 사용자가 요청할 때만 한다(`AGENTS.md`).

---

## 7. PR을 낸다면

- 방향: `refactor/loc-token-limits` ← `refactor/simplify-duplication`
  (**`main` ← 아님**. 기준 브랜치가 아직 main에 병합되지 않았다.)
- 제목 예: `chore: 결정론적 코드 품질 게이트를 켜고 기준선을 36% 줄인다`
- 반드시 **`Squash and merge`**(`gh pr merge --squash`).
- PR 본문에 넣을 것: 게이트가 재는 지표와 한계, 기준선 203→130, 커밋별 요약,
  그리고 **할스테드는 파일 단위라 함수 분리로는 안 줄어든다**는 점.
