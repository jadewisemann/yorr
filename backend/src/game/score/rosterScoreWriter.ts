import type { Redis } from 'ioredis'
import { playersKey, scoresKey } from '../../room/keys.js'

/**
 * 방 명단에 **남아 있는 사람의 점수만** 방 점수 해시에 남긴다.
 *
 * 결투·다빈치·탁구가 같은 두 줄을 각자 갖고 있던 것을 여기로 모았다. 세 게임 모두
 * 점수판 Lua(2.6 `CONFIRM_SCORE`)를 쓰지 않는데, 그쪽은 족보 12칸·중복 제출·보너스를
 * 판정하는 야추 전용 파이프라인이고 여기서 쓰는 것은 **판정이 이미 끝난 정수 하나**이기
 * 때문이다. 같은 해시(`room:{code}:scores`)에 쓰므로 종료 판정(2.7 `readTotals`)과
 * 조회 REST가 그대로 읽는다.
 *
 * **명단에 없는 사람을 거르는 이유:** 몰수하거나 떠난 플레이어는 이 시점보다 먼저
 * 명단에서 지워진다(`removePlayer` → `rooms.leave`). 거르지 않으면 LEAVE가 지운 점수
 * 항목이 되살아나고 `game.over` 순위에 없는 사람이 끼어든다.
 *
 * roster 확인과 기록은 원자적이지 않다 — 그 사이에 떠난 참가자의 점수가 남을 수 있는데,
 * 순위 산출(`rankTotals`)이 roster를 기준으로 하므로 화면에는 드러나지 않는다.
 */
export async function writeRosterScores(
  redis: Redis,
  roomId: string,
  scores: Iterable<readonly [string, number]>,
): Promise<void> {
  for (const [playerId, score] of scores) {
    if ((await redis.hexists(playersKey(roomId), playerId)) !== 1) continue
    await redis.hset(scoresKey(roomId), playerId, String(score))
  }
}
