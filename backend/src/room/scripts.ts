import type { AtomicScript } from '../infra/memoryRedis.js'

/**
 * 방 상태 전이 스크립트. 반환 코드가 곧 계약이므로 조건 순서를 바꾸지 않는다
 * (docs/design/rooms-and-sessions.md 「원자적 스크립트」). Lua 원문을 한 줄씩 옮긴 것이다
 * — `run`은 동기 함수라 도중에 다른 명령이 끼어들지 않는다(infra/memoryRedis.ts).
 *
 * CLOSE·TOUCH는 참가자 수가 가변이라 게임 키 이름을 스크립트 안에서 조립한다.
 */

/** KEYS: room / ARGV: capacity, hostId, gameCode, ttlSeconds, mode → 0 충돌(재시도) · 1 생성 */
export const CREATE: AtomicScript = {
  name: 'yorrRoomCreate',
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

/**
 * KEYS: room, players, game, bots / ARGV: gameId, roomCode, minPlayers → 0(모든 실패) · 1
 *
 * **실패 사유 구분 불가가 계약이다** — 호출부는 전부 `game_not_ready`로 뭉갠다.
 * 인원 검사는 `HLEN players`라 봇도 정원을 채운다.
 */
export const START: AtomicScript = {
  name: 'yorrRoomStart',
  keys: 4,
  args: 3,
  run(r, [room, players, game, bots], [gameId, roomCode, minPlayers]) {
    if (r.exists(room) === 0) return 0
    if (r.hget(room, 'phase') !== 'LOBBY') return 0
    if (r.hlen(players) < Number(minPlayers)) return 0
    const gameCode = r.hget(room, 'gameCode')
    if (gameCode === null) return 0
    r.hset(room, 'phase', 'PLAYING', 'gameId', gameId)
    r.hset(game, 'roomCode', roomCode, 'gameCode', gameCode)
    const ttl = r.pttl(room)
    if (ttl > 0) {
      r.pexpire(game, ttl)
      if (r.exists(bots) === 1) r.pexpire(bots, ttl)
    }
    return 1
  },
}

/**
 * KEYS: room, game / ARGV: gameId → 0 · 1
 *
 * 모듈 초기화가 실패했을 때 **자기 게임만** 되돌린다 — gameId가 일치할 때만.
 */
export const ROLLBACK_START: AtomicScript = {
  name: 'yorrRoomRollbackStart',
  keys: 2,
  args: 1,
  run(r, [room, game], [gameId]) {
    if (r.hget(room, 'phase') !== 'PLAYING') return 0
    if (r.hget(room, 'gameId') !== gameId) return 0
    r.hset(room, 'phase', 'LOBBY')
    r.hdel(room, 'gameId')
    r.del(game)
    return 1
  },
}

/**
 * KEYS: room → 0 · 1
 *
 * 본 경기 전 준비 단계가 취소됐을 때 방을 다시 대기실로 연다. gameId를 인자로
 * 받지 않는 이유는 준비 중 이탈 경로가 방 코드만 알고 있기 때문이다.
 */
export const CANCEL_ACTIVE_GAME: AtomicScript = {
  name: 'yorrRoomCancelActiveGame',
  keys: 1,
  args: 0,
  run(r, [room]) {
    if (r.exists(room) === 0) return 0
    if (r.hget(room, 'phase') !== 'PLAYING') return 0
    const gameId = r.hget(room, 'gameId')
    r.hset(room, 'phase', 'LOBBY')
    r.hdel(room, 'gameId')
    if (gameId !== null) r.del(`game:${gameId}`)
    return 1
  },
}

/**
 * KEYS: room, players, scores, bots → 0(FINISHED 아님) · 1
 *
 * 총점 해시(scores)를 0으로 되돌리는 게 핵심이다 — 이건 gameId가 아니라 방에
 * 매달려 있어서 초기화하지 않으면 다음 게임 순위에 지난 게임 점수가 얹힌다.
 * 점수판(`game:{id}:scoreboard:*`)은 결과 조회용으로 남긴다.
 */
export const RETURN_TO_LOBBY: AtomicScript = {
  name: 'yorrRoomReturnToLobby',
  keys: 4,
  args: 0,
  run(r, [room, players, scores, bots]) {
    if (r.exists(room) === 0) return 0
    if (r.hget(room, 'phase') !== 'FINISHED') return 0
    r.hset(room, 'phase', 'LOBBY')
    r.hdel(room, 'gameId')
    for (const player of r.hkeys(players)) r.hset(scores, player, '0')
    const ttl = r.pttl(room)
    if (ttl > 0) {
      r.pexpire(scores, ttl)
      if (r.exists(bots) === 1) r.pexpire(bots, ttl)
    }
    return 1
  },
}

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
