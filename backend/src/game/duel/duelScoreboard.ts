import type { Redis } from 'ioredis'
import { playersKey, scoresKey } from '../../room/keys.js'
import type { DuelScoreboardPort } from './duelPorts.js'

/**
 * 결투의 점수 기록 어댑터 — Java `DuelGameService.changed`가 `StringRedisTemplate`으로
 * 직접 하던 두 줄(`hasKey(players, id)` → `put(scores, id, score)`)을 여기로 뺐다.
 *
 * 점수판 Lua(2.6 `CONFIRM_SCORE`)를 쓰지 않는다: 그쪽은 족보 12칸·중복 제출·보너스를
 * 판정하는 야추 전용 파이프라인이고, 결투의 점수는 **판정이 이미 끝난 잔탄 하나**다.
 * 같은 해시(`room:{code}:scores`)에 쓰므로 종료 판정(2.7 `readTotals`)과 조회 REST가
 * 그대로 읽는다.
 *
 * roster 확인과 기록이 원자적이지 않은 것은 Java와 같다 — 그 사이에 떠난 참가자의
 * 점수가 남을 수 있는데, 그 경우 순위 산출(`rankTotals`)이 roster를 기준으로 하므로
 * 화면에는 드러나지 않는다.
 */
export class RedisDuelScoreboard implements DuelScoreboardPort {
  constructor(private readonly redis: Redis) {}

  async writeScores(roomId: string, scores: ReadonlyMap<string, number>): Promise<void> {
    for (const [playerId, score] of scores) {
      // 방을 떠난 플레이어는 이 시점보다 먼저 명단에서 지워진다.
      // 사라진 참가자의 점수 항목을 되살리지 않는다.
      if ((await this.redis.hexists(playersKey(roomId), playerId)) !== 1) continue
      await this.redis.hset(scoresKey(roomId), playerId, String(score))
    }
  }
}
