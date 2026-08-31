import type { Redis } from 'ioredis'
import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { gameKey, gameScoreboardKey, playersKey, roomKey } from '../../../room/keys.js'
import {
  type GameScoreQueryReason,
  isGameScoreQueryError,
  type ReadOnlyRedis,
  RedisGameScoreQueryStore,
} from '../index.js'

const ROOM_CODE = 'ROOM1'
const PLAYER_A = 'player-a'
const PLAYER_B = 'player-b'

/**
 * Java 단위 테스트는 `RedisTemplate`을 모킹해 "읽는 사이 게임이 바뀐다"를
 * 만들었다. 여기서는 **진짜 Redis** 위에서 읽기 사이에 실제 쓰기를 끼워 넣는
 * 래퍼로 같은 인터리빙을 만든다 — 값은 전부 Redis에서 나오므로 스토어가 스스로
 * 계약을 정의해 버리는 문제가 없다.
 */
describeRedis('RedisGameScoreQueryStore', () => {
  const redis = useRedis()

  const store = (client: ReadOnlyRedis = redis()): RedisGameScoreQueryStore =>
    new RedisGameScoreQueryStore(client)

  const startGame = async (gameId: string, phase = 'PLAYING'): Promise<void> => {
    const client: Redis = redis()
    await client.hset(roomKey(ROOM_CODE), 'gameId', gameId, 'phase', phase, 'capacity', '4')
    await client.hset(gameKey(gameId), 'roomCode', ROOM_CODE)
    await client.hset(playersKey(ROOM_CODE), PLAYER_A, 'A')
  }

  const expectReason = async (
    operation: () => Promise<unknown>,
    reason: GameScoreQueryReason,
  ): Promise<void> => {
    await expect(operation()).rejects.toSatisfy((error: unknown) =>
      isGameScoreQueryError(error, reason),
    )
  }

  it('점수판을 playerId 오름차순으로 읽는다', async () => {
    await startGame('game-1')
    await redis().hset(playersKey(ROOM_CODE), PLAYER_B, 'B')
    await redis().hset(gameScoreboardKey('game-1', PLAYER_B), 'yacht', '50', '_total', '50')

    const snapshot = await store().findByRoomId(ROOM_CODE, PLAYER_A)

    expect(snapshot.gameId).toBe('game-1')
    expect(snapshot.phase).toBe('PLAYING')
    expect([...snapshot.scoreboards.keys()]).toEqual([PLAYER_A, PLAYER_B])
    // 해시가 아예 없는 플레이어도 12키 전부 null인 점수판으로 나온다
    expect(snapshot.scoreboards.get(PLAYER_A)?.categories.yacht).toBeNull()
    expect(snapshot.scoreboards.get(PLAYER_B)?.categories.yacht).toBe(50)
    expect(snapshot.scoreboards.get(PLAYER_B)?.total).toBe(50)
  })

  it('읽는 도중 게임이 바뀌면 다시 읽어 새 게임을 돌려준다', async () => {
    await startGame('game-a')
    await redis().hset(gameScoreboardKey('game-a', PLAYER_A), '_total', '10')

    // 첫 방 해시 읽기 직후 게임을 game-b로 교체한다(Java 테스트의 인터리빙).
    let switched = false
    const racing: ReadOnlyRedis = {
      hget: (key, field) => redis().hget(key, field),
      hgetall: async (key) => {
        const value = await redis().hgetall(key)
        if (!switched && key === roomKey(ROOM_CODE)) {
          switched = true
          await redis().hset(gameKey('game-b'), 'roomCode', ROOM_CODE)
          await redis().hset(gameScoreboardKey('game-b', PLAYER_A), '_total', '20')
          await redis().hset(roomKey(ROOM_CODE), 'gameId', 'game-b')
        }
        return value
      },
    }

    const snapshot = await store(racing).findByRoomId(ROOM_CODE, PLAYER_A)

    expect(snapshot.gameId).toBe('game-b')
    expect(snapshot.scoreboards.get(PLAYER_A)?.total).toBe(20)
  })

  it('두 번 읽어도 계속 바뀌면 STORE_FAILURE다', async () => {
    await startGame('game-a')

    let generation = 0
    const neverSettles: ReadOnlyRedis = {
      hget: (key, field) => redis().hget(key, field),
      hgetall: async (key) => {
        const value = await redis().hgetall(key)
        if (key === roomKey(ROOM_CODE)) {
          generation += 1
          const gameId = `game-${generation}`
          await redis().hset(gameKey(gameId), 'roomCode', ROOM_CODE)
          await redis().hset(roomKey(ROOM_CODE), 'gameId', gameId)
        }
        return value
      },
    }

    await expectReason(() => store(neverSettles).findByRoomId(ROOM_CODE, PLAYER_A), 'STORE_FAILURE')
  })

  it('명단이 바뀌어도 다시 읽는다', async () => {
    await startGame('game-1')

    let joined = false
    const joining: ReadOnlyRedis = {
      hget: (key, field) => redis().hget(key, field),
      hgetall: async (key) => {
        const value = await redis().hgetall(key)
        if (!joined && key === playersKey(ROOM_CODE)) {
          joined = true
          await redis().hset(playersKey(ROOM_CODE), PLAYER_B, 'B')
        }
        return value
      },
    }

    const snapshot = await store(joining).findByRoomId(ROOM_CODE, PLAYER_A)

    expect([...snapshot.scoreboards.keys()]).toEqual([PLAYER_A, PLAYER_B])
  })

  it('없는 방·빈 roomId는 ROOM_NOT_FOUND다', async () => {
    await expectReason(() => store().findByRoomId('NOPE', PLAYER_A), 'ROOM_NOT_FOUND')
    await expectReason(() => store().findByRoomId('  ', PLAYER_A), 'ROOM_NOT_FOUND')
  })

  it('빈 requesterId는 PLAYER_NOT_IN_ROOM이다', async () => {
    await expectReason(() => store().findByRoomId(ROOM_CODE, ''), 'PLAYER_NOT_IN_ROOM')
  })

  it('gameId가 없는 방은 GAME_NOT_STARTED다', async () => {
    await redis().hset(roomKey(ROOM_CODE), 'phase', 'LOBBY', 'capacity', '4')

    await expectReason(() => store().findByRoomId(ROOM_CODE, PLAYER_A), 'GAME_NOT_STARTED')
  })

  it('게임이 다른 방을 가리키면 ROOM_NOT_FOUND다', async () => {
    await startGame('game-1')
    await redis().hset(gameKey('game-1'), 'roomCode', 'OTHER')

    await expectReason(() => store().findByRoomId(ROOM_CODE, PLAYER_A), 'ROOM_NOT_FOUND')
  })

  it('명단에 없는 사람은 PLAYER_NOT_IN_ROOM이다', async () => {
    await startGame('game-1')

    await expectReason(() => store().findByRoomId(ROOM_CODE, '난입자'), 'PLAYER_NOT_IN_ROOM')
  })

  it('알 수 없는 phase는 STORE_FAILURE다', async () => {
    await startGame('game-1', 'ARCHIVED')

    await expectReason(() => store().findByRoomId(ROOM_CODE, PLAYER_A), 'STORE_FAILURE')
  })

  it('정수가 아닌 점수 값은 STORE_FAILURE다', async () => {
    await startGame('game-1')
    await redis().hset(gameScoreboardKey('game-1', PLAYER_A), 'yacht', 'fifty')

    await expectReason(() => store().findByRoomId(ROOM_CODE, PLAYER_A), 'STORE_FAILURE')
  })
})
