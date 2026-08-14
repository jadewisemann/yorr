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
   * 라운드 상태는 있는데 활성 마감이 없다. pause로 타이머가 멈춘 방에 재접속하면
   * 실제로 도달한다(docs/design/reconnect.md 「알려진 틈」 — Java 그대로 둔다).
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
