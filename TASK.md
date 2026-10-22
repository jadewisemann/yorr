# TASK — 품질 게이트 도입과 기준선 정리

> **이 문서는 세션을 넘겨 작업을 이어가기 위한 인수인계다.**
> 마지막 갱신: 2026-10-22
> 브랜치: `refactor/simplify-duplication`
> 기준 브랜치: `refactor/loc-token-limits` (`2a92cc5`) — **`main`이 아니다**

---

## 1. 현재 상태 (실측, 2026-10-22)

작업 트리는 **깨끗하고** 모든 게이트가 통과한다.

| 검증 | 결과 |
|---|---|
| `npm run check:quality` | 통과 — 파일 532 · 함수 1917 · 기준선 위반 **95건** · **신규 0건** |
| `npm run check:tokens` | 통과 |
| `npm run check:loc` | 통과 |
| `npm run test:quality` | 29개 통과 |
| 백엔드 `vitest run` | 113 파일 · **1333개 통과** |
| 백엔드 `tsc --noEmit` | 통과 |
| 프론트 `tsc -b` | 통과 |
| 프론트 `npm test` | 155 파일 · **1194개 통과** |
| 양쪽 `biome check` | 통과 (프론트 경고 2건은 기존 `trajectory.ts` non-null assertion) |
| 프론트 `check:cycles` | 순환 0 |

## 2. 기준선 현황

| 지표 | 시작(2026-10-21) | 이전 인수인계 | 현재 | 상한 |
|---|---|---|---|---|
| 기준선 위반 | 203 | 130 | **95** | — |
| functionLines | 72 | 58 | 51 | 80줄 |
| halsteadDifficulty | 29 | 28 | **24** | 80 |
| parameters | 40 | 12 | **5** | 5 |
| nesting | 29 | 17 | 10 | 4 |
| cyclomatic | 22 | 15 | **5** | 22 |
| duplicateBlocks | 0 | 0 | 0 | 0 |
| deadExports | 11 | 0 | 0 | 0 |

**완전 해소**: 중복 0, 죽은 export 0, 매개변수는 5건(전부 이미 상한 언저리).

## 3. 이번 세션에 한 일 (커밋, 오래된 것부터)

```
ac8b42f refactor: mock REST·실시간 핸들러를 endpoint 묶음으로 나눈다
a7523da refactor: 메모리 Redis 명령을 타입별 모듈로 나눈다
3e5ab41 refactor: 야추 굴림 훅의 요청·입력·주사위 동작을 나눈다
53f775f refactor: 방 스크립트와 라운드 상태의 계약·전이를 파일로 가른다
c8298dd refactor: 탁구 3D 씬을 만들기·움직이기·그리기로 가른다
098643f refactor: 랜딩 화면의 이동·캐러셀 입력을 훅으로 나눈다
c32da83 refactor: 점수표의 족보 행과 보너스 행을 나눈다
74d7c91 refactor: 대기실 파생 상태와 이동 효과를 가른다
4d1cf60 refactor: 야추 수신 메시지 판정을 순수 함수로 뺀다
3ac7180 refactor: 서버 조립 순서를 runtime과 봇 배선으로 나눈다
6d5c8f0 refactor: 애니메이션 시드와 마스코트 자세 입력을 묶는다
6fa179d refactor: 로컬 탁구 타구 판정 입력을 묶고 품질 계산을 뺀다
bc5a7d0 refactor: 탁구 프레임 계산과 소리 예약을 훅 밖으로 뺀다
2608259 refactor: 수신 판정 묶음을 메모해 리스너 재등록을 막는다
5547e33 refactor: 닉네임 화면의 제출 상태를 훅으로 뺀다
25268b1 refactor: 빠른 대전 폴링을 훅으로 뺀다
dba455f refactor: 게임 화면의 분기와 방 가드를 나눈다
```

### 파일 분리의 정본 위치

- **mock**: `frontend/src/mocks/rest/*Handlers.ts` + `rest/types.ts`·`rest/context.ts`·
  `rest/serializers.ts`; 실시간은 `mocks/realtime/{handlers,context,systemHandlers,
  roomHandlers,yachtHandlers}.ts`. `restHandlers.ts`·`realtimeScenarios.ts`는 배럴.
- **메모리 Redis**: `infra/redisKeyspace.ts`(상태·만료·상한·스크립트 선언),
  `redisStrings/Hashes/Zsets/KeyCommands.ts`, `redisSnapshot.ts`, `redisCore.ts`(표면).
- **방 스크립트**: `room/scripts/{lifecycle,expiry,gameFlow,bots}.ts`.
- **라운드**: `game/round/roundStateContracts.ts`(계약·검증), `roundTransitions.ts`(전이),
  `roundDice.ts`(KEEP 병합).
- **서버 조립**: `composition/runtime.ts`(라운드→조회→모듈→방), `composition/botWiring.ts`.
- **탁구 3D**: `rendering/sceneStage.ts`(만들기)·`sceneMotions.ts`(움직이기)·
  `scene3d.ts`(렌더러·뷰포트·분할).
- **랜딩**: `landing/model/useEntryNavigation.ts`(이동·로그아웃)·`useCarouselDrag.ts`·
  `useCarouselKeys.ts`.
- **야추 굴림**: `yacht/model/roll/{availability,useRollRequest,useDiceActions,useGesture,
  incomingChecks}.ts`.
- **방 화면**: `room/model/{lobbyState,useNicknameEntry,useQuickMatch,useGamePage}.ts`,
  `room/screens/gameScreens.ts`.
- **탁구 프레임**: `pingpong/model/frameState.ts`, `domain/swingQuality.ts`.

## 4. 남은 95건의 성격

- **functionLines 51건** — 거의 전부 큰 JSX 화면(예: `yacht/screens/GamePlay.tsx` 309줄,
  `landing/screens/EntryPage.tsx` 169, `room/screens/LobbyPage.tsx` 153) 또는 3D 씬 조립.
  TASK §5의 "A 방향(JSX 예외)"을 아직 적용하지 않았다.
- **halsteadDifficulty 24건** — 파일 단위 지표라 **파일을 더 나눠야** 준다. 남은 상위는
  `backend/src/game/davinci/davinciGameService.ts`(110), `yacht/bot/expectimaxYachtBotPolicy.ts`(109),
  `frontend/src/yacht/rendering/physics-dice/remap.ts`(109), `backend/src/game/duel/duelRules.ts`(107).
- **parameters 5건** — `collectFacePips`·`createTrajectoryPlan`·`detectTrajectoryImpacts`·
  `CourtOverlay.dashboardSituationLabel`·`pingPongRules.recordOnly`. 전부 6~7개로 1~2개 초과.
- **nesting 10건 / cyclomatic 5건** — 남은 것은 대부분 큰 컴포넌트 한 덩어리.

## 5. 이어서 한다면 — 권장 순서

**A. 게이트에 JSX 예외를 넣는 방향 (여전히 권장)**
"한 화면 = 한 컴포넌트"가 정당한 설계인 경우가 많다. `tools/check-code-quality.mjs`의
`isProduction`에 예외를 더하거나, `functionLines`를 JSX 파일에만 120~150으로 완화한다.
**근거를 코드 주석과 QUALITY.md에 남길 것.** 대상은 functionLines 51건 대부분.

**B. 실제로 값어치 있는 개별 처리**
- `backend/src/game/davinci/davinciGameService.ts` (할스테드 110) — 규칙/서비스 분리 여지.
- `frontend/src/yacht/rendering/physics-dice/remap.ts` (109) — 궤적 계산을 파일로 가른다.
- `frontend/src/yacht/screens/GamePlay.tsx` (309줄) — 화면 구획 분할. 단 props 타입이
  여러 개 따라온다(TASK §5-1의 함정).

**C. 여기서 PR (가장 안전)**
현 상태는 모든 게이트가 초록이고 신규 위반 0이다. `Squash and merge`로 PR을 내고,
남은 95건은 별도 티켓으로 쪼개는 편이 리뷰하기 좋다.

## 6. 작업을 이어갈 때 지킬 것

- **게이트를 통과시키려고 타입을 느슨하게 만들지 않는다.** `as never`·`as unknown as`·
  `require()` 같은 우회는 즉시 되돌린다(이번 세션에 한 번 시도했다가 고쳤다).
- **위반이 이동만 하는 분리는 하지 않는다.** 함수를 빼서 새 함수가 위반이 되면 순이득 0.
- **한 커밋 = 한 가지 정리.** 커밋 후 `node tools/check-code-quality.mjs --write-baseline`으로
  기준선을 줄여 둔다(안 하면 다음 사람이 "사라진 위반"을 보게 된다).
- 리팩터링 후에는 **해당 영역 테스트만** 돌리고, 마무리에 전체를 한 번 돈다.
- push·PR은 사용자가 요청할 때만 한다(`AGENTS.md`).

## 7. PR을 낸다면

- 방향: `refactor/loc-token-limits` ← `refactor/simplify-duplication`
  (**`main` ← 아님**. 기준 브랜치가 아직 main에 병합되지 않았다.)
- 제목 예: `chore: 결정론적 코드 품질 게이트를 켜고 기준선을 53% 줄인다`
- 반드시 **`Squash and merge`**(`gh pr merge --squash`).
- PR 본문: 게이트가 재는 지표와 한계, 기준선 203→95, 커밋별 요약,
  그리고 **할스테드는 파일 단위라 함수 분리로는 안 줄어든다**는 점.
