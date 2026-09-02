import { gameScoreboardKey } from '../../room/keys.js'
import type { ScoreBoard } from './scoreBoard.js'
import { scoreBoardFromHash } from './scoreBoardMapper.js'
import { ScoreDomainError } from './scoreErrors.js'

/**
 * Redis 해시에서 점수판 하나를 읽어 도메인 값으로 옮긴다.
 *
 * 값이 규약을 어겼을 때 **무엇으로 던지느냐**는 부르는 쪽마다 다르다(확정 경로는
 * `ScoreConfirmationError`, 조회 경로는 `GameScoreQueryError`). 그래서 그 자리만 훅으로
 * 받는다 — 규약을 어긴 값을 그대로 흘려보내지 않는다는 규칙은 여기 한 곳에 있다.
 */
/** 이 함수가 Redis에 요구하는 전부. 조회 경로는 읽기 전용 포트만 들고 있다. */
export interface ScoreBoardHashReader {
  hgetall(key: string): Promise<Record<string, string>>
}

export async function readScoreBoard(
  redis: ScoreBoardHashReader,
  gameId: string,
  playerId: string,
  storeFailure: (playerId: string, cause: ScoreDomainError) => Error,
): Promise<ScoreBoard> {
  const stored = await redis.hgetall(gameScoreboardKey(gameId, playerId))
  try {
    return scoreBoardFromHash(stored)
  } catch (error) {
    if (error instanceof ScoreDomainError) throw storeFailure(playerId, error)
    throw error
  }
}
