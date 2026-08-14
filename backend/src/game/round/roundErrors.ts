/**
 * 라운드 동기화 실패의 이유 코드 — backend-java
 * `RoundSynchronizationException.Reason` enum과 이름까지 1:1이다.
 *
 * 이 값들은 **와이어 코드가 아니다.** WS 오류 코드로의 매핑은 게임 모듈이
 * 한다(docs/design/game-modules.md 「RoundState」):
 * PLAYER_NOT_IN_ROUND→`NOT_IN_ROOM`, NOT_ACTIVE_PLAYER·ALREADY_SUBMITTED→
 * `NOT_YOUR_TURN`, ROUND_NOT_INITIALIZED→`INTERNAL`, 나머지→`INVALID_MESSAGE`.
 */
export type RoundSyncReason =
  | 'INVALID_ROUND'
  | 'INVALID_PLAYER'
  | 'INVALID_DICE'
  | 'INVALID_ROLL'
  | 'INVALID_CATEGORY'
  | 'ROUND_NOT_INITIALIZED'
  | 'ROUND_ALREADY_INITIALIZED'
  | 'ROUND_MISMATCH'
  | 'PLAYER_NOT_IN_ROUND'
  | 'NOT_ACTIVE_PLAYER'
  | 'ALREADY_SUBMITTED'
  /** 마지막 라운드까지 끝난 게임에 굴림·제출이 들어왔다. 종료 후 지연 요청의 1차 방어선. */
  | 'GAME_ALREADY_FINISHED'

/**
 * Java `RoundSynchronizationException`(unchecked) 자리.
 *
 * `errors.ts`의 `DomainError`/`ConflictError`를 **상속하지 않는다** — 저쪽은
 * REST의 소문자 문자열 코드 계약(400/404/409)이고, 이쪽은 게임 모듈이 WS 코드로
 * 옮기는 도메인 이유 코드다. 두 계층을 섞으면 라운드 오류가 REST 상태 코드
 * 매핑에 우연히 걸린다.
 */
export class RoundSynchronizationError extends Error {
  readonly reason: RoundSyncReason

  constructor(reason: RoundSyncReason, message: string) {
    super(message)
    this.name = 'RoundSynchronizationError'
    this.reason = reason
  }
}

/** 테스트·호출부에서 이유 코드로 분기할 때 쓴다. */
export const isRoundSyncError = (
  error: unknown,
  reason?: RoundSyncReason,
): error is RoundSynchronizationError =>
  error instanceof RoundSynchronizationError && (reason === undefined || error.reason === reason)
