/**
 * 점수 도메인의 **인자 검증 실패** — Java `IllegalArgumentException` 자리.
 *
 * `errors.ts`의 `DomainError`를 상속하지 않는다(라운드 도메인과 같은 이유):
 * 저쪽은 REST의 소문자 문자열 코드 계약이고, 이쪽은 도메인 내부 검증이라
 * 상위 계층이 `ScoreConfirmationError`의 이유 코드로 옮겨 담는다.
 */
export class ScoreDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoreDomainError'
  }
}

/**
 * 점수 확정 실패의 이유 코드 — backend-java
 * `ScoreConfirmationException.Reason` enum과 이름까지 1:1이다.
 *
 * **와이어 코드가 아니다.** WS 오류 코드로의 매핑은 야추 모듈(3.1)이 한다.
 * 그중 `GAME_NOT_FOUND`·`GAME_NOT_ACTIVE`·`PLAYER_NOT_IN_GAME`·
 * `ROUND_ALREADY_SCORED`·`CATEGORY_ALREADY_USED`는 **CONFIRM_SCORE Lua의 반환
 * 코드에서 직접 나온다**(docs/design/game-modules.md 「CONFIRM_SCORE Lua」).
 */
export type ScoreConfirmationReason =
  | 'INVALID_CATEGORY'
  | 'INVALID_DICE'
  | 'GAME_NOT_FOUND'
  | 'GAME_NOT_ACTIVE'
  | 'PLAYER_NOT_IN_GAME'
  | 'ROUND_ALREADY_SCORED'
  | 'CATEGORY_ALREADY_USED'
  | 'STORE_FAILURE'

/** Java `ScoreConfirmationException`(unchecked) 자리. */
export class ScoreConfirmationError extends Error {
  readonly reason: ScoreConfirmationReason

  constructor(reason: ScoreConfirmationReason, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ScoreConfirmationError'
    this.reason = reason
  }
}

/** 테스트·호출부에서 이유 코드로 분기할 때 쓴다. */
export const isScoreConfirmationError = (
  error: unknown,
  reason?: ScoreConfirmationReason,
): error is ScoreConfirmationError =>
  error instanceof ScoreConfirmationError && (reason === undefined || error.reason === reason)
