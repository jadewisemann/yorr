# 게임 모듈

> 상위 원칙은 [DESIGN.md](../../DESIGN.md). Java 원본: `game/module/`,
> `game/round/`, 게임별 패키지(`game/yacht/`·`game/duel/`·`game/pingpong/`).

## GameModule

게임 하나 = 모듈 하나(`src/game/module.ts`). 인터페이스는 Java `GameModule`과
1:1 대응을 유지한다 — 수명주기(start/reset/pause/resume/removePlayer/close),
상태 보유 여부(hasState), 메시지 라우팅(handles/handle).

- `GameModuleRegistry`가 코드·메시지 타입으로 모듈을 찾는다. WS 게이트웨이는
  `sys.*`·`room.*` 외의 메시지를 레지스트리로 넘긴다.
- 게임별 상태는 Redis에 게임별 키로 둔다(예: duel·pingpong의 상태 스토어).
  모듈 인메모리에는 권위 상태를 두지 않는다.

## 라운드 프레임워크 (게임 공통)

- RoundState + 마감(deadline) 타이머. 마감 예약은 프로세스 재시작·유실에
  대비한 복구 경로를 갖는다(Java `OrphanedRoundStateSweeper` 대응 — 예약이
  사라져 방이 멈추는 레이스가 실제로 있었다).
- 점수 확정 흐름: `round.submit` → 서버 재계산·검증 → Lua 원자 갱신 성공 시에만
  제출 완료 → `score.update` broadcast → 전원 제출 시 `round.end`.
  저장 실패 시 그 플레이어는 미제출로 남는다.

## 불변식

- **점수·판정은 서버가 재계산한다.** 클라이언트가 보낸 계산 결과를 신뢰하지
  않는다(주사위 물리 결과 포함 — DESIGN.md 원칙 1·2).
- **도메인 규칙은 전송 계층을 모른다.** 점수 계산·판정 로직은 WS·HTTP 타입을
  import하지 않는다. (Java의 ScoreConfirmationService 분리와 동일)
- 게임 추가 시 손댈 곳: `game/<게임>/` 구현 + 레지스트리 등록. 게이트웨이·방
  로직은 건드리지 않는다.
