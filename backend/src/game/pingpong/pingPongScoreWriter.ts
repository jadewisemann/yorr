import type { Redis } from 'ioredis'
import { writeRosterScores } from '../score/rosterScoreWriter.js'
import type { PingPongScoreWriter } from './pingPongPorts.js'
import type { PingPongPlayerNumbers } from './pingPongState.js'

/**
 * 종료 시 최종 점수를 방 점수 해시에 남기는 Redis 어댑터. 기록 규칙 자체는 세 게임이
 * 같아 `score/rosterScoreWriter.ts`에 있다.
 *
 * 라운드 게임(야추)은 점수 확정 Lua가 같은 해시를 갱신한다 — 탁구는 라운드 프레임워크를
 * 쓰지 않으므로 종료 직전에 한 번에 기록하는 이 경로가 유일하다.
 */
export const redisPingPongScoreWriter = (redis: Redis): PingPongScoreWriter => ({
  async record(roomId: string, scores: PingPongPlayerNumbers): Promise<void> {
    await writeRosterScores(redis, roomId, Object.entries(scores))
  },
})
