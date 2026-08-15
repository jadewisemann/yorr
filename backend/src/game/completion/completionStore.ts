import type { Redis } from 'ioredis'
import { registerLuaScripts, runLuaNumber } from '../../infra/lua.js'
import { playersKey, roomKey, scoresKey } from '../../room/keys.js'
import { SCORE_CATEGORIES } from '../score/index.js'
import { COMPLETION_SCRIPTS, FINISH_IF_COMPLETE, FINISH_IF_COMPLETE_CODE } from './scripts.js'

/**
 * 요트 정규룰 족보 수. 이만큼 기록되면 그 플레이어의 점수판은 꽉 찬 것이다.
 *
 * Java는 12를 리터럴로 박아 뒀지만 여기서는 점수 도메인의 목록 길이를 쓴다 —
 * 두 목록이 갈라지면 "제출은 되는데 게임이 안 끝나는" 상태가 되기 때문이다.
 */
const REQUIRED_CATEGORIES = SCORE_CATEGORIES.length

/**
 * 게임 종료 전이의 권위 — backend-java `GameCompletionStore`.
 *
 * "끝났는지 판정"과 "phase를 FINISHED로 바꾸기"를 **한 원자 연산**으로 묶는다.
 * 판정을 서버 메모리가 아니라 저장소에서 하는 이유:
 * - 점수판이 곧 진행도다 — 클라이언트가 보낸 값이 아니라 서버가 확정해 저장한 값으로 판정한다.
 * - 인스턴스가 재시작·증설돼도 판정 기준이 흔들리지 않는다.
 * - 전이가 CAS라, 마지막 제출과 타임아웃 만료가 동시에 도착해도 `true`는 한 번만 나온다.
 *   즉 `game.over` 중복 방송이 구조적으로 불가능하다.
 */
export interface GameCompletionStore {
  /**
   * 게임이 끝났으면 phase를 PLAYING → FINISHED로 바꾼다.
   *
   * @param force true면 점수판 완료 검사를 건너뛴다. 라운드 상한에 도달한 경우로,
   *   타임아웃 때문에 빈 칸이 남아도 게임이 끝나지 않는 상황을 막는 안전망이다.
   * @returns 이 호출이 실제로 전이를 수행했는지. true인 호출자만 종료를 방송해야 한다.
   */
  finishIfComplete(roomCode: string, gameId: string, force: boolean): Promise<boolean>

  /** 방의 플레이어별 최종 총점(playerId → total). 순위 산출용. */
  readTotals(roomCode: string): Promise<Map<string, number>>
}

/** Redis 어댑터. 전이 한 번 = **FINISH_IF_COMPLETE Lua 한 번**이다. */
export class RedisGameCompletionStore implements GameCompletionStore {
  private readonly redis: Redis

  constructor(redis: Redis) {
    this.redis = redis
    registerLuaScripts(redis, COMPLETION_SCRIPTS)
  }

  async finishIfComplete(roomCode: string, gameId: string, force: boolean): Promise<boolean> {
    if (roomCode.trim().length === 0 || gameId.trim().length === 0) return false

    const result = await runLuaNumber(
      this.redis,
      FINISH_IF_COMPLETE,
      [roomKey(roomCode), playersKey(roomCode)],
      [gameId, force ? '1' : '0', String(REQUIRED_CATEGORIES)],
    )
    return result === FINISH_IF_COMPLETE_CODE.FINISHED_BY_THIS_CALL
  }

  /** 값이 숫자가 아니면 0으로 본다(Java `NumberFormatException` → 0과 같다). */
  async readTotals(roomCode: string): Promise<Map<string, number>> {
    const stored = await this.redis.hgetall(scoresKey(roomCode))
    const totals = new Map<string, number>()
    for (const [playerId, total] of Object.entries(stored)) {
      const parsed = Number.parseInt(total, 10)
      totals.set(playerId, Number.isNaN(parsed) ? 0 : parsed)
    }
    return totals
  }
}
