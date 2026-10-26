# TASK — 품질 게이트 도입과 기준선 정리

> **이 문서는 세션을 넘겨 작업을 이어가기 위한 인수인계다.**
> 마지막 갱신: 2026-10-26
> 브랜치: `refactor/split-halstead-hotspots`
> 기준 브랜치: `refactor/loc-token-limits` (`2a92cc5`) — **`main`이 아니다**

---

## 1. 현재 상태 (실측, 2026-10-26)

작업 트리는 깨끗하고 **모든 게이트가 통과하며, 기준선 위반이 0건**이다.

| 검증 | 결과 |
|---|---|
| `npm run check:quality` | 통과 — 파일 589 · 함수 2158 · 기준선 위반 **0건** |
| `npm run check:tokens` · `check:loc` | 통과 |
| `npm run test:quality` | 31개 통과 |
| 백엔드 `vitest run` · `tsc --noEmit` · `biome check` | 113 파일 **1333개 통과** · 통과 · 통과 |
| 프론트 `tsc -b` · `biome check` · `check:cycles` | 통과 · 경고 2건(기존 `trajectory.ts`) · **순환 0** |
| 프론트 `npm test` | 155 파일 · **1194개 통과** |
| 프론트 `build` | 통과 |

## 2. 기준선 현황

| 지표 | 시작(10-21) | 10-22 | 10-26 이전 | **현재** | 상한 |
|---|---|---|---|---|---|
| 기준선 위반 | 203 | 95 | 24 | **0** | — |
| halsteadDifficulty | 29 | 24 | 24 | **0** | 80 |
| functionLines · parameters · nesting · cyclomatic | 72·40·29·22 | 51·5·10·5 | 0 | **0** | 80·5·4·22 |
| duplicateBlocks · deadExports | 0 · 11 | 0 · 0 | 0 · 0 | **0 · 0** | 0 |

`tools/quality-baseline.json`의 `violations`가 빈 객체다. 즉 **예외 없이 전 파일이
상한 아래**이고, 앞으로의 새 위반은 그대로 게이트에서 막힌다.

## 3. 이번에 한 일 (10-26)

**할스테드 난이도 24건 → 0건.** 함수를 쪼개서는 줄지 않는 지표라 파일을 책임별로
갈랐다. 커밋은 21개, 전부 `refactor:` 접두이며 **기존 테스트를 하나도 고치지 않았다.**

### 백엔드 (16건 → 0)

| 원본 | 뺀 파일 | 성격 |
|---|---|---|
| `duelRules.ts` | `duelRound.ts` | 라운드 판정(반응 비교·파울·쏘기) |
| `duelGameService.ts` | `duelProgress.ts` | 방송·마감 예약·종료 정산 |
| `pingPongRules.ts` | `pingPongScoring.ts` | 득점·서브·몰수 |
| `pingPongGameService.ts` | `pingPongProgress.ts` · `pingPongResume.ts` | 진행·방 정리 / 재접속·복구 |
| `davinciRules.ts` | `davinciSetup.ts` | 시작 패 나누기·점수 |
| `davinciGameService.ts` | `davinciInput.ts` · `davinciProgress.ts` · `davinciResume.ts` | 검증·덱 섞기 / 좌석별 방송 / 복구 |
| `expectimaxYachtBotPolicy.ts` | `expectimaxDiceMath.ts` · `expectimaxOutcomes.ts` · `expectimaxScoreChoice.ts` · `expectimaxSearch.ts` | counts 조작 / 확률 분포 / 칸 선택 / 탐색 본체 |
| `yachtBotTurnCoordinator.ts` | `yachtBotTurnGuard.ts` · `yachtBotHeldIdentity.ts` | 턴 동일성 / 킵 자리 재해석 |
| `yachtDiceGameModule.ts` | `yachtLifecycle.ts` · `yachtWsErrors.ts` | 수명주기 / 오류 매핑 |
| `redisYachtDiceStateStore.ts` | `redisYachtRoomLock.ts` · `redisYachtSnapshot.ts` | 락 / 직렬화 경계 |
| `roundStateStore.ts` | `roundStateStoreInMemory.ts` | 포트 / 인메모리 어댑터 |
| `roundTimerService.ts` | `roundTurnClock.ts` · `roundOfflineTurns.ts` | 마감 계산·예약 / 오프라인 처리 |
| `quickMatchService.ts` | `quickMatchRunner.ts` · `quickMatchKeys.ts` | 매칭·자동 시작 / 키 규칙 |
| `http/routes/rooms.ts` | `roomBotRoutes.ts` · `roomRouteErrors.ts` | 봇 API / 오류 매핑 |
| `ws/handler.ts` | `roomLifecycle.ts` · `logger.ts` | 종료·퇴장·폐쇄 / 로거 |
| `ws/registry.ts` | `roomMembers.ts` | 좌석 명단 |

### 프론트엔드 (8건 → 0)

| 원본 | 뺀 파일 |
|---|---|
| `pingpong/domain/localGame.ts` | `localBall.ts` · `localBot.ts` · `localSwing.ts` · `localMath.ts` |
| `yacht/domain/yachtGame.ts` | `yachtTurn.ts` (+ `yachtTypes.ts`는 뒤이은 정리) |
| `yacht/input/MotionGestureRecognizer.ts` | `motionCalibration.ts` · `shakeDetector.ts` · `throwDetector.ts` |
| `realtime/controllerLink/controllerLink.ts` | `peerSession.ts` · `linkChannels.ts` |
| `yacht/rendering/physics-dice/model.ts` | `pips.ts` · `roundedRect.ts` |
| `yacht/rendering/physics-dice/remap.ts` | `remapSimulation.ts` · `remapRetry.ts` · `remapScore.ts` |
| `yacht/rendering/physics-dice/World.ts` | `worldReplay.ts` · `resultLayout.ts` · `worldStages.ts` |
| `landing/rendering/heroScene.ts` | `heroStage.ts` · `heroSceneObjects.ts` |

### 마지막 정리

- **순환 의존 제거** — `localTypes.ts`·`yachtTypes.ts`로 도메인 타입을 분리해
  `localSwing → localBot → localGame`, `yachtTurn → yachtGame` 순환을 없앴다.
  `npm run check:cycles`가 0을 보고한다.
- **방 락 키 접미사 회귀** — `${stateKey}:lock`을 스토어가 직접 만들던 것을
  `RoomLock.withLock`으로 옮겼다. `pr79` 회귀 테스트(잠금 사용처는 전부
  `UNLOCK_IF_OWNER`)가 다시 초록이다.

## 4. 옮기면서 고친 것 (동작 변화 2건)

둘 다 **버그에 가까운 순서 문제**였고, 기존 테스트가 그 계약을 이미 요구하고 있었다.

1. `roundTurnClock`의 마감 콜백을 `void`로 감싸 즉시 발화를 기대하던 테스트 3개가
   깨졌다. 예약기가 반환값을 기다리도록 시그니처를 넓혔다 — 마감 처리 뒤 방송 완료가
   실제 계약이다.
2. 컨트롤러 링크에서 **피어를 맵에 등록한 뒤 협상**하도록 순서를 고정했다. 이전에는
   offer를 만드는 동안 도착한 시그널이 같은 id로 두 번째 피어를 만드는 창이 있었다.

## 5. 이어서 한다면

**A. 여기서 PR (권장)** — 기준선이 0이 됐고 모든 게이트가 초록이다.

**B. 게이트 자체의 남은 한계** — QUALITY.md 4절의 계획 항목이다.
- `CRAP`·생존 돌연변이(Stryker)·`any`/`unknown` 0건은 아직 계획 단계다.
- 프론트 커버리지는 96~98%이고 렌더링·개발 화면 일부가 측정 대상에서 빠져 있다.

**C. 추가 분할은 이제 근거가 약하다** — 할스테드 상한이 80인데, 현재 최고값은
`heroScene.ts`(77) 근처다. 더 쪼개면 오히려 "한 파일 = 한 책임"이 흐려진다.

## 6. PR을 낸다면

- 방향: `refactor/loc-token-limits` ← `refactor/split-halstead-hotspots`
  (**`main` ← 아님**. 기준 브랜치가 아직 main에 병합되지 않았다.)
- 제목 예: `refactor: 할스테드 24건을 파일 분할로 해소하고 기준선을 0으로 만든다`
- 반드시 **`Squash and merge`**(`gh pr merge --squash`).
- PR 본문: 할스테드는 파일 단위라 함수 분리로는 안 줄어든다는 점, 백엔드 16건·
  프론트 8건의 분할 표, 기존 테스트를 고치지 않았다는 점, 옮기면서 고친 순서 2건.

## 7. 작업을 이어갈 때 지킬 것

- **게이트를 통과시키려고 타입을 느슨하게 만들지 않는다.** `as never`·`as unknown as`·
  `require()` 같은 우회는 즉시 되돌린다.
- **위반이 이동만 하는 분리는 하지 않는다.** 함수를 빼서 새 함수가 위반이 되면 순이득 0.
- **한 커밋 = 한 가지 정리.** 커밋 후 `node tools/check-code-quality.mjs --write-baseline`으로
  기준선을 줄여 둔다.
- 리팩터링 후에는 **해당 영역 테스트만** 돌리고, 마무리에 전체를 한 번 돈다.
- push·PR은 사용자가 요청할 때만 한다(`AGENTS.md`).
