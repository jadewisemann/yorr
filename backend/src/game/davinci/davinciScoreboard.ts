import type { Redis } from 'ioredis'
import { playersKey, scoresKey } from '../../room/keys.js'
import type { DavinciScoreboardPort } from './davinciPorts.js'

/**
 * 다빈치 코드의 점수 기록 어댑터 — 결투 `RedisDuelScoreboard`와 같은 두 줄이다.
 *
 * 점수판 Lua(2.6 `CONFIRM_SCORE`)를 쓰지 않는 이유도 같다: 그쪽은 족보 12칸·중복
 * 제출·보너스를 판정하는 야추 전용 파이프라인이고, 여기서 쓰는 것은 판정이 끝난 정수
 * 하나다. 같은 해시(`room:{code}:scores`)에 쓰므로 종료 판정(2.7 `readTotals`)과 조회
 * REST가 그대로 읽는다.
 */
export class RedisDavinciScoreboard implements DavinciScoreboardPort {
  constructor(private readonly redis: Redis) {}

  async writeScores(roomId: string, scores: ReadonlyMap<string, number>): Promise<void> {
    for (const [playerId, score] of scores) {
      // 방을 떠난 플레이어는 이 시점보다 먼저 명단에서 지워진다. 사라진 참가자의
      // 점수 항목을 되살리지 않는다.
      if ((await this.redis.hexists(playersKey(roomId), playerId)) !== 1) continue
      await this.redis.hset(scoresKey(roomId), playerId, String(score))
    }
  }
}
