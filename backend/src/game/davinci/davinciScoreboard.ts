import type { Redis } from 'ioredis'
import { writeRosterScores } from '../score/rosterScoreWriter.js'
import type { DavinciScoreboardPort } from './davinciPorts.js'

/**
 * 다빈치 코드의 점수 기록 어댑터. 기록 규칙 자체는 세 게임이 같아
 * `score/rosterScoreWriter.ts`에 있다.
 */
export class RedisDavinciScoreboard implements DavinciScoreboardPort {
  constructor(private readonly redis: Redis) {}

  async writeScores(roomId: string, scores: ReadonlyMap<string, number>): Promise<void> {
    await writeRosterScores(this.redis, roomId, scores)
  }
}
