# 야추(요트 다이스) 도메인

> SSOT: [`../../src/yacht/domain/scoring.ts`](../../src/yacht/domain/scoring.ts) (점수 규칙),
> [`../../src/yacht/domain/yachtGame.ts`](../../src/yacht/domain/yachtGame.ts) (턴 리듀서),
> [`../../src/yacht/model/useGamePlayRoll.ts`](../../src/yacht/model/useGamePlayRoll.ts) (턴 흐름 엔진)

## 레이어 구조

| 폴더 | 책임 | 규칙 |
|---|---|---|
| `domain/` | 순수 규칙 — dice · scoring · specialHands · yachtGame · leverage, 로컬 모드 가짜 서버(localGame · tutorialGame · leverageGame) | React·DOM·네트워크를 모른다 |
| `screens/` | GamePlay 합성 루트, 결과 화면 | |
| `model/` | 상태·훅 — useGamePlayRoll(턴 흐름 엔진) 등 | **비공개** 세그먼트 |
| `components/` | 게임판 UI (점수시트·타이머·리액션·튜토리얼 가이드…) | |
| `rendering/physics-dice/` | 3D 주사위 — [dice-physics.md](./dice-physics.md) | **비공개** — `screens`·`realtime`·`store` import 금지 |
| `input/` | DeviceMotion 제스처 — [motion-input.md](./motion-input.md) | |
| `feedback/` | 진동·효과음·족보 보이스 — [motion-input.md](./motion-input.md) | |

## 규칙 (12 카테고리)

상단 `ones..sixes`(해당 눈 합, 소계 63↑ 보너스 35) + 하단 `choice`(총합) ·
`fourOfAKind`(4개 이상이면 총합) · `fullHouse`(정확히 2+3이면 총합) · `smallStraight`(15) ·
`largeStraight`(30) · `yacht`(50). 3 of a kind는 없다.

- 라운드당 최대 3굴림, 굴릴 때마다 킵 가능. 포기한 카테고리는 0점으로 사용 처리.
- 클라이언트는 **후보 점수만** 로컬 계산(`calculateScoreCandidates`)하고, 기록된 점수·총점·
  순위는 전부 서버 확정값을 쓴다.
- 주사위 난수: `dice.ts`의 LCG(1664525/1013904223, 상위 비트 사용). 로컬 모드가 쓰고,
  온라인에서는 서버 값(`targetDice`)이 항상 우선한다.
- 레버리지 변형(`domain/leverage.ts`): scoring.ts를 건드리지 않고 결과에 2배를 곱하는 한 겹.
  이번 턴의 2배 족보는 **시드 결정론**으로 뽑는다 — 점수 매기는 쪽과 미리보기가 같은 족보를
  봐야 하므로 같은 LCG를 쓴다.

## 턴 리듀서 (`yachtGame.ts`)

`phase: ready → rolling → choosing → submitting → roundComplete`, 액션 9종.

비자명한 규칙들:

- **`rollCount`는 서버가 `dice.broadcast`로 알려준 값을 그대로 쓴다.** 클라가 직접 세면
  애니메이션 교체 시 증가분이 유실돼 서버와 어긋난다.
- **`forced`(서버 자동 굴림)는 로컬 phase가 무엇이든 받아들인다** — 서버 상태가 이미
  확정됐으니 거부하면 화면만 뒤처진다.
- `heldSynced`: 관전자가 턴 주인의 KEEP을 따라가는 경로 — 토글이 아니라 전체 배열이라
  한 번 놓쳐도 다음 동기화에서 복구된다.
- `restoreYachtGame`: 재접속·새 마운트 시 서버 스냅샷의 턴 진행(rollCount·dice·held)으로
  로컬 상태를 되살린다. 이 경로가 없으면 턴 중간에 새로고침한 클라가 0굴림으로 시작해
  서버와 어긋난다. 지난 굴림 애니메이션은 재생하지 않고 `choosing`에 바로 앉힌다.
- 다섯 개를 전부 킵하면 굴림 요청 자체를 무시한다.

## 화면 합성 (`GamePlay.tsx`)

`ConnectionBanner → GamePlayHeader → TurnStrip → (GameDiceTray | GameControllerPad) →
guide? → GamePlayActions → RecordPanel(모바일) / ScoreSheet(1024px↑ 우측)`.

- **레이아웃이 바뀌어도 트리 한 벌만 쓴다.** 넓이별로 다른 트리를 반환하면 React가 주사위
  영역을 언마운트해 rapier 월드와 WebGL 컨텍스트가 통째로 재생성된다.
- **마감 처리는 서버가 한다** (대신 굴리기·자동 기록·턴 넘김). 클라가 같은 일을 하면 두
  경로가 경합하므로 화면은 아무것도 하지 않는다.
- 파티 대시보드는 플레이어가 아니다 — `canPlay = membershipRole !== 'dashboard'`,
  센서·조작 안내 없음. 파티 QR로 들어온 폰은 좁은 화면에서 컨트롤러로 뜬다
  (`GameControllerPad` — WebGL 없이 `PhysicsDiceFallback`을 조작면으로 재사용).
- 단축키: Space=굴리기, 1~5=킵. 마지막 굴림 후 모바일에서는 기록 시트가 자동으로 열린다.
- 레버리지 족보는 미리보기부터 2배로 보인다 — 기록하고 나서야 알면 고를 수 없다.

## 턴 흐름 (`useGamePlayRoll`)

내 턴(모션): `shakeStarted → dice.roll 전송(흔들기 시작 시점!) → 서버 dice.broadcast →
rollRequested(targetDice 확보) → throwDetected → dice.throw 전송 + world.pour() →
궤적 재생 → completeRoll(서버 값으로 확정) → 족보 감지 → 콜아웃·보이스`.

- `dice.roll`은 던지는 순간이 아니라 **흔들기 시작**에 나간다 — 던질 때 결과를 기다리면
  손을 놓고 한 박자 뒤에야 주사위가 날아간다.
- 탭 경로: `roll()` 후 600ms 타이머가 자동으로 쏟는다.
- 관전자 경로: `dice.shaken`이 흔들림 펄스를, `dice.thrown`이 쏟는 시점을 전달. 던지기
  신호가 broadcast보다 먼저 오는 순서 역전은 큐로 처리한다.
- `requestId`와 애니메이션 시드는 서버 사실(방·플레이어·라운드·굴림수·주사위)에서 파생 —
  굴린 사람과 관전자 전원이 같은 물리 연출로 수렴한다.
- 제출(`useGamePlaySubmission`): `round.submit`에 `msgId`를 실어 보내고 `score.update`의
  echo로 성공을, `error.refMsgId`로 실패를 매칭한다. 서버 타임아웃 자동 기록은
  기록 diff로 감지해 토스트로 알린다.

## 로컬 모드 — 화면 재사용 원칙

**화면을 따로 만들지 않고 서버 자리만 갈아끼운다.** `createLocalYachtClient(mode)`가
실서버 계약 그대로(`dice.broadcast`·`hold_changed`·`score.update`·`round.start`·`game.over`)
응답하는 `FakeRealtimeClient`를 만든다. 모드는 "주사위를 정하는 방법"과 "점수를 매기는
방법"만 주입한다. 추상화는 여기까지 — 규칙 이상으로 달라지면 파일을 복제한다.

| 모드 | 라우트 | 특징 |
|---|---|---|
| 튜토리얼 (`tutorialGame.ts`) | `/tutorial` | 대본 굴림 `[6,6,2,3,5]→[6,6,6,4,1]→[6,6,6,6,2]` — 킵의 이득이 숫자로 보인다. 사용자가 대본과 다르게 킵해도 킵한 자리는 존중한다. `TutorialGuide`가 `GamePlay`의 `guide` 슬롯에 꽂힌다 |
| 레버리지 (`leverageGame.ts`) | `/leverage` | 12라운드, 매 턴 시드 결정론으로 뽑힌 족보가 2배. 서버가 2배 규칙을 모르므로 로컬 전용 |
| 연결 상태 처리 | | 연습 모드는 마운트 시 `connected`로 두고 나갈 때 `idle`로 되돌린다 — 남기면 실전 화면이 끊긴 소켓을 연결됨으로 착각한다 |

튜토리얼 가이드의 핵심 불변식: **주사위가 날아가는 동안에는 어느 단계도 움직이지 않는다**
— rollCount는 굴림 시작에 오르고 dice는 애니메이션이 끝나야 바뀌므로, 그 사이에 판단하면
"새 굴림 수 + 옛 주사위"를 읽는다. "다시 보지 않기"는 쿠키 1년(방 세션 40분보다 길어야
해서 localStorage 대신 만료 명시 가능한 쿠키).

## 결과 화면

- 순위·총점은 서버 `game.over`의 `rankings`를 그대로 쓴다. 로컬 재계산은 `score.update`를
  하나라도 놓치면 다른 등수를 보여주므로 폴백으로만 남긴다.
- 대시보드는 `PartyResultDashboard`로 분기 — 폰용 `GameResult`를 그대로 쓰면 명단에 없는
  세션이 꼴등 0점 유령 플레이어로 TV에 뜬다. 재대결(대기실 복귀)은 host 폰만.
- 알려진 경계 예외: `GameResult → room/api/useGameApi` 직접 호출 (GamePage 콜백으로
  내리면 사라진다 — 별도 티켓).

타이머: 서버는 tick을 보내지 않고 `deadline`만 내려준다. `useCountdown`이 초 경계에
맞춰서만 갱신한다.
