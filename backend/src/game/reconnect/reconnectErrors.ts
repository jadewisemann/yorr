/**
 * 재접속 스냅샷 조립 실패의 이유 코드.
 *
 * Java는 두 경우 모두 `IllegalStateException`이고, WS 핸들러 바깥으로 나가면
 * `INTERNAL` 오류 + 팬아웃 등록 해제로 이어진다(docs/design/reconnect.md
 * 「스냅샷 내용」). 이유를 잃지 않으려고 코드로 구분해 둔다 — **와이어 코드는
 * 아니다.** 둘 다 WS `INTERNAL`로 매핑하는 것이 계약이고, 매핑은 게임 모듈(3.1)이 한다.
 */
export type ReconnectSnapshotReason =
  /** 방 phase는 playing인데 라운드 상태가 없다. */
  | 'ROUND_NOT_INITIALIZED'
  /**
   * 라운드 상태는 있는데 활성 마감이 없다.
   *
   * **원인이 하나로 줄었다**(deploy/PLAN.md PR 6). 예전에는 원인이 둘이었고 그중
   * 하나가 재시작이었다 — 마감이 프로세스 인메모리에만 있었으므로 재시작 뒤 첫
   * 재접속은 **반드시** 이 오류였다. 지금은 부팅 재무장(`game/startupResume.ts`)이
   * 저장된 마감으로 되살리고, 되살리지 못한 방은 그 자리에서 닫히므로 재시작이
   * 이 오류로 이어지지 않는다.
   *
   * 남은 원인은 **pause 상태의 방에 재접속**하는 경로다: 방이 비면 `pause`가
   * 마감을 끊는데 재접속 분기는 `resume`을 부르지 않는다(최초 join 분기만 부른다 —
   * docs/design/reconnect.md 「알려진 틈」). 이쪽은 PR 6의 범위가 아니다. 고치려면
   * "멈춰 있을 때만 재개"라는 판정이 필요한데, 그것 없이 재접속마다 `resume`을
   * 부르면 진행 중인 턴의 시계가 매번 새로 시작되어 **재접속으로 자기 제한 시간을
   * 늘릴 수 있다.**
   */
  | 'DEADLINE_NOT_FOUND'

/**
 * Java `IllegalStateException` 자리.
 *
 * `errors.ts`의 `ConflictError`를 상속하지 **않는다** — 저쪽은 REST의 소문자
 * 문자열 코드 계약(409)이고, 이쪽은 WS 코드로 옮겨질 도메인 이유 코드다
 * (2.5 `RoundSynchronizationError`가 같은 이유로 분리돼 있다).
 */
export class ReconnectSnapshotError extends Error {
  readonly reason: ReconnectSnapshotReason

  constructor(reason: ReconnectSnapshotReason, message: string) {
    super(message)
    this.name = 'ReconnectSnapshotError'
    this.reason = reason
  }
}

/** 테스트·호출부에서 이유 코드로 분기할 때 쓴다. */
export const isReconnectSnapshotError = (
  error: unknown,
  reason?: ReconnectSnapshotReason,
): error is ReconnectSnapshotError =>
  error instanceof ReconnectSnapshotError && (reason === undefined || error.reason === reason)
