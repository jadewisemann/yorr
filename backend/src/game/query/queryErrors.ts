/**
 * 조회 도메인의 **인자 검증 실패**
 * (`GameResultCalculator.validate`·`GameScoreSnapshot` 생성 검증).
 *
 * `errors.ts`의 `DomainError`를 상속하지 **않는다**. 저쪽은 방 REST의 plain-text
 * 소문자 코드 계약(`room_not_found` …)이고 조회 REST는 JSON `{code,message}`라
 * 오류 표면이 아예 다르다 — 상속시키면 `sendDomainError`가 조회 오류를 텍스트
 * 404로 바꿔 내보낸다.
 */
export class GameQueryDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameQueryDomainError'
  }
}

/**
 * 조회 실패의 이유 코드.
 *
 * **와이어 코드가 아니다.** HTTP 상태·응답 `code`로의 매핑은 라우트가 한다
 * (`http/routes/gameQueries.ts`, docs/design/game-modules.md 「조회 REST」):
 * `PLAYER_NOT_IN_ROOM`만 이름이 바뀌어 `NOT_IN_ROOM`으로,
 * `STORE_FAILURE`는 `INTERNAL`로 나간다.
 */
export type GameScoreQueryReason =
  | 'ROOM_NOT_FOUND'
  | 'GAME_NOT_STARTED'
  | 'PLAYER_NOT_IN_ROOM'
  | 'GAME_NOT_FINISHED'
  | 'STORE_FAILURE'

/** 조회 실패 — 이유 코드를 실어 던진다. */
export class GameScoreQueryError extends Error {
  readonly reason: GameScoreQueryReason

  constructor(reason: GameScoreQueryReason, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GameScoreQueryError'
    this.reason = reason
  }
}

/** 테스트·라우트에서 이유 코드로 분기할 때 쓴다. */
export const isGameScoreQueryError = (
  error: unknown,
  reason?: GameScoreQueryReason,
): error is GameScoreQueryError =>
  error instanceof GameScoreQueryError && (reason === undefined || error.reason === reason)
