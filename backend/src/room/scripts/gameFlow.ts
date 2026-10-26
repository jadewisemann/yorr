import type { AtomicScript } from '../../infra/memoryRedis.js'

/**
 * 게임 시작·되돌리기·대기실 복귀. 방 phase 전이와 gameId 정리가 여기 모여 있다 —
 * "지금 무슨 게임이 도는가"를 아는 스크립트들이라 함께 봐야 순서가 보인다.
 */
/**
 * KEYS: room, players, game, bots / ARGV: gameId, roomCode, minPlayers → 0(모든 실패) · 1
 *
 * **실패 사유 구분 불가가 계약이다** — 호출부는 전부 `game_not_ready`로 뭉갠다.
 * 인원 검사는 `HLEN players`라 봇도 정원을 채운다.
 */
export const START: AtomicScript = {
  name: 'yorrRoomStart',
  creates: [2],
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
  creates: [2],
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
