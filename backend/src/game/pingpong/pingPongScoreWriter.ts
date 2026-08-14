import type { Redis } from 'ioredis'
import { playersKey, scoresKey } from '../../room/keys.js'
import type { PingPongScoreWriter } from './pingPongPorts.js'
import type { PingPongPlayerNumbers } from './pingPongState.js'

/**
 * 종료 시 최종 점수를 방 점수 해시에 남기는 Redis 어댑터 — Java
 * `PingPongGameService.changed`가 `StringRedisTemplate`으로 직접 하던 일이다.
 *
 * **roster에 있는 사람만 쓴다.** 몰수한 플레이어는 이 시점에 이미 방에서
 * 빠졌으므로(`removePlayer` → `rooms.leave`가 먼저 돈다) 걸러내지 않으면 LEAVE가
 * 지운 점수 항목이 되살아나고, `game.over` 순위에 없는 사람이 끼어든다.
 *
 * 라운드 게임(야추)은 점수 확정 Lua가 같은 해시를 갱신한다 — 탁구는 라운드
 * 프레임워크를 쓰지 않으므로 종료 직전에 한 번에 기록하는 이 경로가 유일하다.
 */
export const redisPingPongScoreWriter = (redis: Redis): PingPongScoreWriter => ({
  async record(roomId: string, scores: PingPongPlayerNumbers): Promise<void> {
    for (const [playerId, score] of Object.entries(scores)) {
      if ((await redis.hexists(playersKey(roomId), playerId)) === 0) continue
      await redis.hset(scoresKey(roomId), playerId, String(score))
    }
  },
})
