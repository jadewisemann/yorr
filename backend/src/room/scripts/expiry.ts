import type { AtomicScript } from '../../infra/memoryRedis.js'

/**
 * 슬라이딩 TTL 갱신. 방·참가자·점수·게임 키의 만료를 같은 시각으로 맞춘다.
 *
 * 참가자 수가 가변이라 게임 키 이름을 스크립트 안에서 조립한다.
 */
/**
 * KEYS: room, players, scores, bots / ARGV: ttlSeconds → 0 방 없음 · 1
 *
 * 활동 시각 갱신(sliding TTL). 이게 없으면 TTL이 "생성 후 40분"이라 활발히
 * 플레이 중인 방도 정해진 시각에 사라지고, 남은 사람은 계속 노는데 신규 참가만
 * 404가 나는 상태가 된다.
 */
export const TOUCH: AtomicScript = {
  name: 'yorrRoomTouch',
  keys: 4,
  args: 1,
  run(r, [room, players, scores, bots], [ttlSeconds]) {
    if (r.exists(room) === 0) return 0
    r.expire(room, ttlSeconds)
    const ttl = r.pttl(room)
    if (ttl <= 0) return 1
    r.pexpire(players, ttl)
    r.pexpire(scores, ttl)
    if (r.exists(bots) === 1) r.pexpire(bots, ttl)
    const gameId = r.hget(room, 'gameId')
    if (gameId !== null) {
      r.pexpire(`game:${gameId}`, ttl)
      for (const player of r.hkeys(players)) {
        r.pexpire(`game:${gameId}:scoreboard:${player}`, ttl)
        r.pexpire(`game:${gameId}:score-submissions:${player}`, ttl)
      }
    }
    return 1
  },
}
