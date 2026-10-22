import type { AtomicScript } from '../../infra/memoryRedis.js'

/**
 * 대기실 봇 추가·삭제. 봇은 사람과 같은 정규 행이고, `bots` 해시가 "이 행은 봇"의
 * 유일한 근거다 — 그래서 세 해시를 함께 쓴다.
 */
/**
 * KEYS: room, players, scores, bots / ARGV: requesterId, botId, nickname, 'BOT'
 * → 0 방 없음 · 2 대기실 아님 · 3 호스트 아님 · 4 정원 · 5 botId 중복 · 1 추가
 *
 * 호스트 판정이 **hostId 일치 + 명단 존재**의 두 조건인 것은 방 조작 API 공통
 * 규약이다 — 방을 떠난 옛 호스트가 남의 방에 봇을 붙이지 못한다. 파티 방도
 * 같다: 방장은 처음 들어온 컨트롤러라 hostId는 항상 명단 안을 가리킨다.
 *
 * 검증을 전부 통과한 뒤에야 세 키(players·scores·bots)를 함께 쓴다 — 봇 행은
 * 사람 행과 같은 정규 행이고, `bots` 해시만이 "이 행은 봇"의 유일한 근거다.
 */
export const BOT_ADD: AtomicScript = {
  name: 'yorrRoomBotAdd',
  creates: [1, 2, 3],
  keys: 4,
  args: 4,
  run(r, [room, players, scores, bots], [requesterId, botId, nickname, marker]) {
    if (r.exists(room) === 0) return 0
    if (r.hget(room, 'phase') !== 'LOBBY') return 2
    if (r.hget(room, 'hostId') !== requesterId) return 3
    if (r.hexists(players, requesterId) === 0) return 3
    if (r.hlen(players) >= Number(r.hget(room, 'capacity'))) return 4
    if (r.hexists(players, botId) === 1) return 5
    r.hset(players, botId, nickname)
    r.hset(scores, botId, '0')
    r.hset(bots, botId, marker)
    r.hincrby(room, 'members', 1)
    const ttl = r.pttl(room)
    if (ttl > 0) {
      r.pexpire(players, ttl)
      r.pexpire(scores, ttl)
      r.pexpire(bots, ttl)
    }
    return 1
  },
}

/**
 * KEYS: room, players, scores, bots / ARGV: requesterId, botId
 * → 0 방 없음 · 2 대기실 아님 · 3 호스트 아님 · 4 봇 없음 · 1 삭제
 *
 * **bots 해시에서 HDEL이 성공해야만** 명단·점수를 지운다 — 이 API로 사람을
 * 쫓아낼 수 없게 하는 조건이다(권한 검사가 아니라 대상 검사).
 */
export const BOT_REMOVE: AtomicScript = {
  name: 'yorrRoomBotRemove',
  keys: 4,
  args: 2,
  run(r, [room, players, scores, bots], [requesterId, botId]) {
    if (r.exists(room) === 0) return 0
    if (r.hget(room, 'phase') !== 'LOBBY') return 2
    if (r.hget(room, 'hostId') !== requesterId) return 3
    if (r.hexists(players, requesterId) === 0) return 3
    if (r.hdel(bots, botId) === 0) return 4
    r.hdel(players, botId)
    r.hdel(scores, botId)
    r.hincrby(room, 'members', -1)
    return 1
  },
}
