import type { Redis } from 'ioredis'
import { registerLuaScripts, runLuaNumber } from '../../infra/lua.js'
import {
  gameKey,
  gameScoreboardKey,
  gameScoreSubmissionsKey,
  playersKey,
  roomKey,
  scoresKey,
} from '../../room/keys.js'
import type { ScoreBoard } from './scoreBoard.js'
import { scoreBoardFromHash } from './scoreBoardMapper.js'
import { isUpperCategory, type ScoreCategory } from './scoreCategory.js'
import { ScoreConfirmationError, ScoreDomainError } from './scoreErrors.js'
import { CONFIRM_SCORE, CONFIRM_SCORE_CODE, SCORE_SCRIPTS } from './scripts.js'

/**
 * 점수판 저장소 포트.
 *
 * 구현이 하는 일은 "저장"이 아니라 **확정**이다 — 중복·순서·보너스 판정을
 * 전부 원자적으로 끝내고 최종 점수판을 돌려준다.
 */
export interface ScoreBoardStore {
  confirmScore(
    gameId: string,
    playerId: string,
    roundNumber: number,
    category: ScoreCategory,
    score: number,
    requestSignature: string,
  ): Promise<ScoreBoard>

  /** 확정된 점수만 담긴 현재 점수판. 아직 기록하지 않은 족보는 값이 null이다. */
  findScoreBoard(gameId: string, playerId: string): Promise<ScoreBoard>
}

/**
 * Redis 어댑터. 확정 한 번 = **CONFIRM_SCORE Lua 한 번**이다
 * (docs/design/game-modules.md 「CONFIRM_SCORE Lua」의 반환 코드 표가 계약).
 *
 * 스크립트 앞의 `HGET game:{id} roomCode`는 KEYS를 조립하기 위한 사전 조회다.
 * 그 값이 스테일이어도 스크립트 안의 양방향 매핑 검증(가드 2·8)이 잡는다.
 */
export class RedisScoreBoardStore implements ScoreBoardStore {
  private readonly redis: Redis

  constructor(redis: Redis) {
    this.redis = redis
    registerLuaScripts(redis, SCORE_SCRIPTS)
  }

  async confirmScore(
    gameId: string,
    playerId: string,
    roundNumber: number,
    category: ScoreCategory,
    score: number,
    requestSignature: string,
  ): Promise<ScoreBoard> {
    const roomCode = await this.redis.hget(gameKey(gameId), 'roomCode')
    if (roomCode === null || roomCode.trim().length === 0) {
      throw new ScoreConfirmationError('GAME_NOT_FOUND', `게임을 찾을 수 없습니다: ${gameId}`)
    }

    const result = await runLuaNumber(
      this.redis,
      CONFIRM_SCORE,
      [
        gameKey(gameId),
        roomKey(roomCode),
        playersKey(roomCode),
        gameScoreboardKey(gameId, playerId),
        gameScoreSubmissionsKey(gameId, playerId),
        scoresKey(roomCode),
      ],
      [
        roomCode,
        gameId,
        playerId,
        String(roundNumber),
        category,
        String(score),
        isUpperCategory(category) ? '1' : '0',
        requestSignature,
      ],
    )

    this.raiseIfFailed(result, gameId, playerId, roundNumber, category)
    return this.readScoreBoard(gameId, playerId)
  }

  async findScoreBoard(gameId: string, playerId: string): Promise<ScoreBoard> {
    return this.readScoreBoard(gameId, playerId)
  }

  /** 반환 코드 → 이유 코드. 0과 5(멱등 재시도)만 통과시킨다. */
  private raiseIfFailed(
    result: number,
    gameId: string,
    playerId: string,
    roundNumber: number,
    category: ScoreCategory,
  ): void {
    switch (result) {
      case CONFIRM_SCORE_CODE.SUCCESS:
      case CONFIRM_SCORE_CODE.IDEMPOTENT_RETRY:
        return
      case CONFIRM_SCORE_CODE.GAME_MISSING:
      case CONFIRM_SCORE_CODE.GAME_ROOM_CHANGED:
      case CONFIRM_SCORE_CODE.ROOM_MISSING:
      case CONFIRM_SCORE_CODE.ROOM_GAME_CHANGED:
        throw new ScoreConfirmationError(
          'GAME_NOT_FOUND',
          `게임 상태가 존재하지 않습니다: ${gameId}`,
        )
      case CONFIRM_SCORE_CODE.GAME_NOT_PLAYING:
        throw new ScoreConfirmationError('GAME_NOT_ACTIVE', `진행 중인 게임이 아닙니다: ${gameId}`)
      case CONFIRM_SCORE_CODE.PLAYER_MISSING:
        throw new ScoreConfirmationError(
          'PLAYER_NOT_IN_GAME',
          `게임 참가자가 아닙니다: ${playerId}`,
        )
      case CONFIRM_SCORE_CODE.ROUND_CONFLICT:
        throw new ScoreConfirmationError(
          'ROUND_ALREADY_SCORED',
          `해당 라운드의 점수가 이미 확정되었습니다: ${roundNumber}`,
        )
      case CONFIRM_SCORE_CODE.CATEGORY_CONFLICT:
        throw new ScoreConfirmationError(
          'CATEGORY_ALREADY_USED',
          `이미 사용한 점수 카테고리입니다: ${category}`,
        )
      default:
        throw new ScoreConfirmationError(
          'STORE_FAILURE',
          `알 수 없는 Redis 점수 확정 결과입니다: ${result}`,
        )
    }
  }

  private async readScoreBoard(gameId: string, playerId: string): Promise<ScoreBoard> {
    const stored = await this.redis.hgetall(gameScoreboardKey(gameId, playerId))
    try {
      return scoreBoardFromHash(stored)
    } catch (error) {
      if (error instanceof ScoreDomainError) {
        throw new ScoreConfirmationError(
          'STORE_FAILURE',
          `Redis 점수판 값이 올바르지 않습니다: ${playerId}`,
          { cause: error },
        )
      }
      throw error
    }
  }
}
