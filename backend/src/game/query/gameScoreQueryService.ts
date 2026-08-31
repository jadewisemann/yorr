import { calculateGameResult, type GameResult } from '../completion/index.js'
import type { ScoreBoard } from '../score/index.js'
import type { GameScoreQueryStore } from './gameScoreQueryStore.js'
import { GameScoreQueryError } from './queryErrors.js'

/**
 * 점수판·최종 결과 조회.
 *
 * 스토어가 방·참가 자격을 판정하고, 이 서비스는 **phase 게이트 두 개**만 얹는다:
 * 점수판은 PLAYING·FINISHED에서, 최종 결과는 FINISHED에서만 나간다.
 *
 * 순위 계산은 게임 종료의 `calculateGameResult`를 그대로 쓴다. 여기서 다시
 * 구현하면 `game.over` 방송과 `/results` 응답의 순위가 갈라진다.
 */
export class GameScoreQueryService {
  constructor(private readonly store: GameScoreQueryStore) {}

  /** playerId 오름차순 점수판. LOBBY면 409 `GAME_NOT_STARTED`. */
  async getScoreboards(
    roomId: string,
    requesterId: string,
  ): Promise<ReadonlyMap<string, ScoreBoard>> {
    const snapshot = await this.store.findByRoomId(roomId, requesterId)
    if (snapshot.phase !== 'PLAYING' && snapshot.phase !== 'FINISHED') {
      throw new GameScoreQueryError('GAME_NOT_STARTED', `진행 중인 게임이 없습니다: ${roomId}`)
    }
    return snapshot.scoreboards
  }

  /**
   * 최종 순위. **진행 중(PLAYING)에도 409**다 — 아직 확정되지 않은 순위를
   * 내보내면 클라이언트가 그것을 결과 화면으로 쓴다.
   *
   * 점수는 `game.over` 방송과 달리 **점수판 해시의 `_total`** 에서 온다
   * (종료 경로는 `room:{id}:scores` ZSET을 읽는다). 의도된 비대칭이다.
   */
  async getResults(roomId: string, requesterId: string): Promise<GameResult> {
    const snapshot = await this.store.findByRoomId(roomId, requesterId)
    if (snapshot.phase !== 'FINISHED') {
      throw new GameScoreQueryError('GAME_NOT_FINISHED', `아직 종료되지 않은 게임입니다: ${roomId}`)
    }
    return calculateGameResult(
      [...snapshot.scoreboards.entries()].map(([playerId, scoreboard]) => ({
        playerId,
        finalScore: scoreboard.total,
      })),
    )
  }
}
