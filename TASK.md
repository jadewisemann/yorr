# TASK — 품질 게이트 도입과 기준선 정리

> **이 문서는 세션을 넘겨 작업을 이어가기 위한 인수인계다.**
> 마지막 갱신: 2026-10-26
> 브랜치: `refactor/simplify-duplication`
> 기준 브랜치: `refactor/loc-token-limits` (`2a92cc5`) — **`main`이 아니다**

---

## 1. 현재 상태 (실측, 2026-10-26)

작업 트리는 **깨끗하고** 모든 게이트가 통과한다.

| 검증 | 결과 |
|---|---|
| `npm run check:quality` | 통과 — 파일 538 · 함수 2064 · 기준선 위반 **24건** · **신규 0건** |
| `npm run check:tokens` · `check:loc` | 통과 |
| `npm run test:quality` | 31개 통과 |
| 백엔드 `vitest run` · `tsc --noEmit` · `biome check` | 113 파일 **1333개 통과** · 통과 · 통과 |
| 프론트 `tsc -b` · `biome check` | 통과 · 경고 2건(기존 `trajectory.ts` non-null assertion) |
| 프론트 `npm test` | 155 파일 · **1194개 통과** |
| 프론트 `check:cycles` · `build` | 순환 0 · 통과 |
| 프론트 `test:e2e` | Chromium 계열 157개 통과. mobile-safari 54개는 이 머신에 WebKit이 없어 실행 불가(코드 문제 아님) |

## 2. 기준선 현황

| 지표 | 시작(10-21) | 10-22 | 현재 | 상한 |
|---|---|---|---|---|
| 기준선 위반 | 203 | 95 | **24** | — |
| functionLines | 72 | 51 | **0** | 80줄 |
| halsteadDifficulty | 29 | 24 | 24 | 80 |
| parameters | 40 | 5 | **0** | 5 |
| nesting | 29 | 10 | **0** | 4 |
| cyclomatic | 22 | 5 | **0** | 22 |
| duplicateBlocks · deadExports | 0 · 11 | 0 · 0 | 0 · 0 | 0 |

**남은 것은 파일 단위 할스테드 24건뿐이다.** JSX 화면에도 예외를 두지 않고
함수 길이 위반을 전부 실제 분리로 해소했다(이전 인수인계의 "A 방향"은 폐기).

## 3. 10-22 이후 한 일

- 게이트 자체 수정: 매개변수 스캐너(타입 인자·끝 쉼표), 중첩 게이트(제어 블록만 셈).
- 함수 길이 49건·순환 복잡도 2건을 영역별로 분리(커밋 40개, `refactor:` 접두).
  기존 테스트는 하나도 고치지 않았다. 효과 등록 순서·의존성 배열·DOM·`data-testid`는
  보존했고, 하위 훅이 ref를 인자로 받으면서 의존성 배열에 ref가 추가된 곳만 있다.
- 새로 생긴 공용 단위:
  - `pingpong/rendering/sceneLoop.ts` — 탁구 훅 셋의 3D 무대·rAF 루프·dt 계산.
  - `shared/useDialogFocus.ts` · `shared/components/DialogScrim.tsx` — Modal·Popover·
    BottomSheet의 포커스 수명과 배경. Tooltip은 동작이 달라 따로 둔다.
  - `room/components/RoomCodeStatus.tsx` — 대기실·파티 대시보드 공통 마크업.
  - `yacht/screens/useGamePlayScreen.ts` · `GamePlaySlots.tsx` — 야추 화면 상태와 구획.
- 알려진 미세 동작 차이: `useSwing.requestPermission`은 권한 API가 없는 브라우저에서도
  `await` 한 번을 거친 뒤 구독한다. `useReturnToLobby`는 대시보드 분기에서 더는 생성되지 않는다.

## 4. 남은 24건 (전부 halsteadDifficulty, 파일 단위)

함수를 나눠도 줄지 않는다. **파일을 책임별로 갈라야** 준다. 상위:
`davinciGameService.ts`·`remap.ts`(110), `expectimaxYachtBotPolicy.ts`(109),
`duelRules.ts`(107), `yachtBotTurnCoordinator.ts`(104), `quickMatchService.ts`(103),
`ws/registry.ts`(102). 81~99 구간이 나머지 17건이다. 전체 목록은
`npm run check:quality:report`.

## 5. 이어서 한다면

**A. 여기서 PR (권장)** — 함수 단위 지표가 전부 0이 되었고 모든 게이트가 초록이다.
할스테드 24건은 파일 분할이라 성격이 다르므로 별도 브랜치로 나누는 편이 리뷰하기 좋다.

**B. 할스테드 파일 분할** — 백엔드 서비스·규칙 파일(16건)부터. `frontend/src/*/domain/`과
`realtime/`은 설계 검토 게이트 대상이므로 문서 일관성을 함께 본다.

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
- 제목 예: `chore: 결정론적 코드 품질 게이트를 켜고 기준선을 203건에서 24건으로 줄인다`
- 반드시 **`Squash and merge`**(`gh pr merge --squash`).
- PR 본문: 게이트가 재는 지표와 한계, 기준선 203→24, 커밋별 요약,
  그리고 **할스테드는 파일 단위라 함수 분리로는 안 줄어든다**는 점.
