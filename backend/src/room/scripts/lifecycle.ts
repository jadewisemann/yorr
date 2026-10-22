import type { AtomicScript } from '../../infra/memoryRedis.js'

/**
 * 방의 생애 — 생성·참가·이탈·폐쇄. 반환 코드가 곧 계약이므로 조건 순서를 바꾸지 않는다
 * (docs/design/rooms-and-sessions.md 「원자적 스크립트」). Lua 원문을 한 줄씩 옮긴 것이다
 * — `run`은 동기 함수라 도중에 다른 명령이 끼어들지 않는다(infra/memoryRedis.ts).
 *
 * CLOSE는 참가자 수가 가변이라 게임 키 이름을 스크립트 안에서 조립한다.
 */
/** KEYS: room / ARGV: capacity, hostId, gameCode, ttlSeconds, mode → 0 충돌(재시도) · 1 생성 */
export const CREATE: AtomicScript = {
  name: 'yorrRoomCreate',
  creates: [0],
  keys: 1,
  args: 5,
  run(r, [room], [capacity, hostId, gameCode, ttlSeconds, mode]) {
    if (r.exists(room) === 1) return 0
    r.hset(
      room,
      'capacity',
      capacity,
      'members',
      '0',
      'phase',
      'LOBBY',
      'hostId',
      hostId,
      'gameCode',
      gameCode,
      'mode',
      mode,
    )
    r.expire(room, ttlSeconds)
    return 1
  },
}

/**
 * KEYS: room, players, scores, bots / ARGV: userId, nickname
 * → 0 없음 · 2 시작됨 · 3 정원 · 4 중복(호출부 미처리 = 성공 취급, 단 TTL 정렬은 건너뛴다) · 1 참가
 *
 * 들어오면서 **주인 없는 방의 방장을 이어받는다** — 파티 방의 대시보드는 명단에
 * 없고, 방장이 나간 방은 hostId가 비어 있다. 둘 다 "다음에 들어온 사람이 방장"으로 풀린다.
 */
export const JOIN: AtomicScript = {
  name: 'yorrRoomJoin',
  creates: [1, 2],
  keys: 4,
  args: 2,
  run(r, [room, players, scores, bots], [userId, nickname]) {
    if (r.exists(room) === 0) return 0
    if (r.hget(room, 'phase') !== 'LOBBY') return 2
    if (r.hexists(players, userId) === 1) return 4
    if (r.hlen(players) >= Number(r.hget(room, 'capacity'))) return 3
    r.hset(players, userId, nickname)
    r.hset(scores, userId, '0')
    r.hincrby(room, 'members', 1)
    const host = r.hget(room, 'hostId')
    if (!host || r.hexists(players, host) === 0) r.hset(room, 'hostId', userId)
    const ttl = r.pttl(room)
    if (ttl > 0) {
      r.pexpire(players, ttl)
      r.pexpire(scores, ttl)
      if (r.exists(bots) === 1) r.pexpire(bots, ttl)
    }
    return 1
  },
}

/**
 * KEYS: room, players, scores, bots / ARGV: playerId
 * → -1 방·좌석 없음 · 0 방이 삭제됨 · 1 잔류
 *
 * 방 삭제는 **파티 방만 예외**다(대시보드는 members에 세어지지 않아 컨트롤러 하나가
 * 들어왔다 나가는 것만으로 QR을 띄운 방이 사라진다). 방장 승계는 두 모드 공통이고
 * 후보는 **사람만** — 봇에게 넘기면 아무도 조작할 수 없다. 참가자가 hash라 입장
 * 순서가 없으므로 **누가 실행해도 같은 결과**인 playerId 오름차순 첫 번째를 쓴다.
 */
export const LEAVE: AtomicScript = {
  name: 'yorrRoomLeave',
  keys: 4,
  args: 1,
  run(r, [room, players, scores, bots], [playerId]) {
    if (r.exists(room) === 0) return -1
    if (r.hdel(players, playerId) === 0) return -1
    r.hdel(scores, playerId)
    r.hdel(bots, playerId)
    const members = r.hincrby(room, 'members', -1)
    if (members <= 0 && r.hget(room, 'mode') !== 'PARTY') {
      r.del(room, players, scores, bots)
      return 0
    }
    if (r.hget(room, 'hostId') === playerId) {
      const heir = r
        .hkeys(players)
        .sort()
        .find((candidate) => r.hexists(bots, candidate) === 0)
      r.hset(room, 'hostId', heir ?? '')
    }
    return 1
  },
}

/** KEYS: room, players, scores, bots → 항상 1(멱등). 게임 키까지 지운다. */
export const CLOSE: AtomicScript = {
  name: 'yorrRoomClose',
  keys: 4,
  args: 0,
  run(r, [room, players, scores, bots]) {
    const gameId = r.hget(room, 'gameId')
    if (gameId !== null) {
      for (const player of r.hkeys(players)) {
        r.del(`game:${gameId}:scoreboard:${player}`, `game:${gameId}:score-submissions:${player}`)
      }
      r.del(`game:${gameId}`)
    }
    r.del(room, players, scores, bots)
    return 1
  },
}
