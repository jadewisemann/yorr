# YORR 프론트엔드 위키

> 기준일: 2026-08-13

이 디렉터리는 프론트엔드 코드베이스가 **실제로 어떻게 동작하는지**를 설명하는 위키다.
이 인덱스에서 출발해 아래 문서 지도에서 필요한 페이지를 골라 읽으면 된다. 페이지마다
SSOT 코드 경로가 달려 있어 코드와 대조해 검증할 수 있다.

(에이전트용 문서 읽기 규칙은 [`../CLAUDE.md`](../CLAUDE.md)에 있다 — 이 위키의
독자는 사람이 우선이다.)

## 문서 지도 (`wiki/`)

| 문서 | 이럴 때 읽는다 |
|---|---|
| [product.md](./wiki/product.md) | 제품 범위·게임 목록·유저 플로우·안전장치 — "지금 뭘 기준으로 만드나?" |
| [architecture.md](./wiki/architecture.md) | 디렉터리 구조·의존 방향·상태 설계·확정 스택·경계 예외 |
| [app-shell.md](./wiki/app-shell.md) | 부팅·라우트 표·코드 스플리팅·View Transitions·dev 화면 |
| [realtime.md](./wiki/realtime.md) | WS 계약(wsEvents SSOT)·연결/재연결·heartbeat·스냅샷 병합 리듀서 |
| [voice.md](./wiki/voice.md) | WebRTC 음성 풀메시·시그널링·iOS 오디오 우회 |
| [room-and-session.md](./wiki/room-and-session.md) | 세션 FSM·저장/복구·방 수명주기·빠른 대전·파티 모드 |
| [rest-api.md](./wiki/rest-api.md) | 프론트가 호출하는 REST 엔드포인트 전체 |
| [landing.md](./wiki/landing.md) | 히어로 캐러셀·모드 선택·랭킹 티커·히어로 3D |
| [auth.md](./wiki/auth.md) | 카카오·구글 로그인·세션 저장·게스트 정책·닉네임 |
| [yacht.md](./wiki/yacht.md) | 야추 규칙·턴 리듀서·화면 합성·튜토리얼/레버리지 로컬 모드 |
| [dice-physics.md](./wiki/dice-physics.md) | 3D 주사위 — 예측 시뮬·서버 값 리맵·재생 파이프라인 |
| [motion-input.md](./wiki/motion-input.md) | 모션 센서 제스처 파이프라인·useSwing·소리/진동 피드백 |
| [pingpong.md](./wiki/pingpong.md) | 탁구 — 기기 분기·clientTs 지연 보상·코트 SSOT·AI 모드 |
| [duel.md](./wiki/duel.md) | 석양이 진다 — 반응 측정·입력 밸런스·착탄 예측·무대 번역 |
| [shared-ui.md](./wiki/shared-ui.md) | 프리미티브 컴포넌트·훅·REST 클라이언트 |
| [design-system.md](./wiki/design-system.md) | 토큰 2계층·cn 병합·레시피·모션 경계 |
| [testing.md](./wiki/testing.md) | 단위 하네스·mock 백엔드 2벌·2단 E2E·커버리지 래칫 |
| [code-rationale.md](./wiki/code-rationale.md) | 코드에서 걷어낸 실측값·실패한 대안·함정 모음 — 값을 바꾸거나 "단순화"하기 전에 심볼을 먼저 찾아본다 |

그 외:

- [portfolio/](./portfolio/index.md) — 프론트엔드 담당자의 포트폴리오 자료 (코드베이스 문서가 아니다)
- [`../.dev.md`](../.dev.md) — S15P11A406-215 리팩터링의 확정 기준·측정 근거,
  [`log/S15P11A406-215.md`](./log/S15P11A406-215.md) — 그 인계 문서 (남은 작업이 끝나면 정리한다)

## 단일 기준(SSOT) 원칙

문서와 코드가 충돌하면 **항상 코드가 이긴다.** 각 페이지 상단의 SSOT 경로가 그 주제의
원본이다. 특히:

- WebSocket 계약: [`../src/realtime/wsEvents.ts`](../src/realtime/wsEvents.ts)
- 게임 카탈로그: [`../src/games.ts`](../src/games.ts)
- 점수 규칙: [`../src/yacht/domain/scoring.ts`](../src/yacht/domain/scoring.ts)
- 디자인 토큰: [`../src/styles/tokens.css`](../src/styles/tokens.css)
- Git 협업 규칙: [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)

문서가 코드와 어긋난 걸 발견하면 그 문서를 고치거나 지운다 — 어긋난 채로 남겨두지 않는다.

## 이 위키의 작성 규약

- **한 파일 = 한 주제.** 도메인 페이지는 파일 지도 → 핵심 설계 결정 → 불변식 순서로 쓴다.
- **"왜"를 남긴다.** 수치·정책에는 근거(실측 버그, 티켓 번호)를 붙인다. 코드 주석에 이미
  있는 근거는 옮겨 적지 말고 요약 + 경로 참조로 충분하다.
- 새 문서는 이 표에 한 줄을 추가한다. 표에 없는 문서는 없는 것과 같다.
- 유효기간이 있는 자료(스프린트 로그·발표 자료·구현 전 검토안)는 두지 않는다 — git
  히스토리가 보관한다.
