import type { Redis } from 'ioredis'
import { writeRosterScores } from '../score/rosterScoreWriter.js'
import type { DuelScoreboardPort } from './duelPorts.js'

/**
 * 결투의 점수 기록 어댑터. 기록 규칙 자체는 세 게임이 같아
 * `score/rosterScoreWriter.ts`에 있다 — 결투가 남기는 값은 **판정이 끝난 잔탄 하나**다.
 */
export class RedisDuelScoreboard implements DuelScoreboardPort {
  constructor(private readonly redis: Redis) {}

  async writeScores(roomId: string, scores: ReadonlyMap<string, number>): Promise<void> {
    await writeRosterScores(this.redis, roomId, scores)
  }
}
