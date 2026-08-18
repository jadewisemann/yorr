# 탁구 (PING_PONG)

> SSOT: [`../../src/pingpong/`](../../src/pingpong/) — `screens/PingPongGame.tsx`(온라인
> 진입점) · `domain/court.ts`(판정 수치 SSOT) · `rendering/scene3d.ts`(Three.js 무대) ·
> `domain/localGame.ts`(AI 모드)

서버 권위 구조 — 화면은 판정하지 않고 입력만 올리고, 서버 상태를 연출로 번역한다.

## 기기 분기

```text
dashboard(membershipRole === 'dashboard')       → 관전 (3D 코트, 좌우 분할 두 시점)
desktop: (min-width:1024px) and (pointer:fine)  → 데스크톱 플레이어 (코트 + 스페이스바/클릭)
그 외                                            → 폰 컨트롤러 (라켓 그림 + 모션/탭 스윙)
```

폭과 입력 capability를 **함께** 본다 — 빠른 대전으로 들어온 사람은 파티방과 같은
`participant`라 방 종류로는 갈릴 수 없고(실측), 폭만 보면 태블릿이 새고
입력만 보면 마우스 꽂은 태블릿이 샌다. `pointer: fine`이 아니면 전부 컨트롤러 — 데스크톱에
컨트롤러가 떠도 스페이스바로 칠 수 있으니 안전한 기본값이다.

## 입력 → 서버

모션 스윙(`useSwing`) · 스페이스바 · 화면 탭이 전부 하나의 `swing()`으로 수렴:
`game.ping_pong.swing { inputSeq, clientTs }`. `inputSeq`는 단조 증가 — 서버가
`<= lastInputSeq`면 무시(중복 차단). 준비는 `game.ping_pong.ready`.

**`clientTs`가 존재하는 이유(지연 보상)**: 서버가 메시지 도착 시각으로 판정하면 업링크
지연이 통째로 "늦게 침"이 된다 — 이상 지점 0.9에서 네트 판정 1.02까지 0.12뿐이라 보통
속도(1.0 pos/s)에서 120ms만 밀려도 완벽한 스윙이 네트로 떨어진다(스매시 리턴은 62ms).
서버는 클라가 찍은 시각으로 **최대 120ms까지 되감아** 판정한다(미래 시각은 서버 시각으로
자름 — `PingPongRules.judgedAt`).

## 코트·궤적 (`court.ts` — 렌더러와 로직의 숫자 SSOT)

- 깊이 좌표 `pos`: 0=P2 끝 … 1=P1 끝. 11점 선승. 판정창은 이상 지점 기준 비대칭
  (-0.18/+0.16)이라 아슬아슬 판정 띠(FAULT_BAND)는 "창 가장자리에서 안쪽으로 얼마"로 잰다.
- 궤적 불변식: **네트 통과는 항상 prog = 0.5** — 네트 통과 높이를 파라미터로 직접 잡지
  않으면 공이 네트를 뚫는다. 높이는 진행도만의 함수라 온라인 관전자도 `pos`만 받아 같은
  궤적을 재현한다(별도 동기화 필드 불필요).
- 서버는 `ball{launchedAt, pos, direction, speed, smash}`만 주고 tick이 없다 — 화면이
  경과 시간을 곱해 위치를 만든다.

## 3D 무대 (`scene3d.ts`)

외부 에셋 0(캔버스 텍스처). 셰도우맵 대신 가짜 그림자 — 공 그림자는 깊이를 읽는 유일한
단서라 물리적 정확함보다 항상 또렷함이 중요하다. 2인 대결은 월드를 뒤집지 않고 반대편
카메라를 하나 더 두고, 자기 몸은 자기 시점에서 숨긴다(화면에는 늘 상대 마스코트만).
canvas가 사라지는 레이아웃 전환(창 좁힘 → 컨트롤러)을 effect 의존성으로 감지해 떨어져
나간 canvas에 그리는 것을 막는다.

## 워밍업과 사용법

- 대기실: `PingPongControllerHowTo`가 연결 시퀀스 마지막 슬롯에서 iOS 모션 권한 + 센서
  실검증을 끝낸다 — 게임 시작 후에 물으면 첫 서브 동안 권한 팝업을 읽게 된다. 이 시점의
  방은 `waiting`이라 서버에는 아무것도 보내지 않는다.
- 빠른 대전은 대기실 사용법을 지나지 않는다 — `PREPARING` 워밍업 화면(연습 스윙 1회 +
  준비 완료)이 첫 안내를 대신한다. `practiced`는 서버가 확인한 스윙(`lastInputSeq ≥ 0`)이
  기준이고, 준비 버튼 문구는 `readyButtonLabel` 한 곳에서만 만든다 — 폰과 데스크톱이 같은
  세 상태를 말해야 한다.

## 피드백

라켓 타격음은 `lastEvent.id` 변화당 1회. 테이블 바운스는 궤적에서 남은 시간을 계산한
**예측 타이머**로 재생. 콤보 티어(3/5/8), 스매시 플래시 220ms. 게임 중 진동은 없다 —
햅틱은 컨트롤러 연결 순간 40ms 한 번뿐.

## 로컬 AI 모드 (`/pingpong`)

서버·소켓 없이 `advanceLocalGame`(rAF 루프) + `localFrameState`를 같은 `scene3d`에 넘긴다.
봇은 난이도별 실패 띠·놓칠 확률·랠리 램프·스매시 되받기 파라미터. 비모션 입력에 260ms
연타 잠금. `solo` 종료 시 결과를 `POST /games/ping-pong/ai-results`로 1회 저장(실패 무시).

## 열린 이슈

- 컨트롤러 판별이 결투(`isPartyRoom` localStorage)와 다른 기준(미디어쿼리)이다 — 같은
  문제에 두 기준이 살아 있다.
- 화면은 `snapshot.game`을 `PingPongState`로 캐스팅해 읽는다 — 와이어 계약이 야추
  모양이라 생긴 임시 봉합([realtime.md](./realtime.md)의 계약 부채).
