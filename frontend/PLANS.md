# PLANS — 진행 중 변경

> "시스템이 어떻게 동작하는가"는 [DESIGN.md](DESIGN.md), 계획이 끝나면 이
> 문서에서 지우고 결과를 설계 문서에 반영한다.

## 현재 상태: 와이어 계약 동결 🧊

백엔드 Java → JS 마이그레이션([backend/PLANS.md](../backend/PLANS.md))이 끝날
때까지 프론트엔드 프로덕션 코드는 변경하지 않는 것이 목표다. 특히
`src/realtime/wsEvents.ts`와 REST 사용부는 **계약 동결** 상태다
([backend ADR-0002](../backend/docs/adr/0002-strangler-wire-contract.md)).
문서·테스트·포트폴리오 작업은 동결과 무관하다.

## 대기 중인 이관 티켓 (동결 해제 후)

| 작업 | 내용 | 근거 |
|---|---|---|
| envelope 게임 무관화 | `wsEvents.ts → yacht/domain/*` 결합 해소 — 게임 무관 envelope + 게임별 payload로 분리 | DESIGN.md 경계 예외 1 |
| GameResult 콜백화 | `yacht/screens/GameResult.tsx → room/api/useGameApi` 직접 호출 제거 — `GamePage`가 콜백으로 내려준다 | DESIGN.md 경계 예외 2 |
| sys.reconnect 라우팅 (티켓 25) | 서버에 `sys.reconnect` 처리 추가 또는 이벤트를 계약에서 제거 — 현재는 보내면 조용히 버려져 `room.join` 재전송으로 우회 중 | IMPLEMENTATION_NOTES 2026-08-14 |

계약을 바꾸는 작업은 모두 백엔드와 함께 결정한다 — 시작할 때 이 문서에 계획을
구체화하고(목표·관련 설계·불변식·검증), 백엔드 PLANS.md와 상호 링크를 건다.
