import type { Redis } from 'ioredis'
import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { gameScoreboardKey, playersKey, roomKey, scoresKey } from '../../../room/keys.js'
import { RoomService } from '../../../room/roomService.js'
import { SCORE_CATEGORIES, TOTAL_FIELD, UPPER_SUBTOTAL_FIELD } from '../../score/index.js'
import { RedisGameCompletionStore } from '../completionStore.js'

const ROOM_CODE = 'ROOM1'
const GAME_ID = 'game-1'
const PLAYERS = ['player-1', 'player-2'] as const

/**
 * backend-java `RedisGameCompletionStoreIntegrationTest` 이식.
 *
 * 게임 종료 전이는 이 Lua 하나에 달려 있다 — 여기가 틀리면 게임이 안 끝나거나
 * (무한 라운드) 진행 중인 게임이 끝나버린다. 두 경우 모두 상태가 통째로 꼬이므로
 * **진짜 Redis**로 검증한다(모킹으로는 원자성·동시성을 볼 수 없다).
 */
describeRedis('RedisGameCompletionStore', () => {
  const redis = useRedis()

  const store = (): RedisGameCompletionStore => new RedisGameCompletionStore(redis())

  const seed = async (): Promise<void> => {
    const client: Redis = redis()
    await client.hset(
      roomKey(ROOM_CODE),
      'phase',
      'PLAYING',
      'gameId',
      GAME_ID,
      'capacity',
      '6',
      'hostId',
      PLAYERS[0],
      'gameCode',
      'YACHT_DICE',
    )
    for (const playerId of PLAYERS) {
      await client.hset(playersKey(ROOM_CODE), playerId, playerId)
      await client.hset(scoresKey(ROOM_CODE), playerId, '0')
    }
  }

  const fillScoreboard = async (playerId: string, categoryCount: number): Promise<void> => {
    for (const category of SCORE_CATEGORIES.slice(0, categoryCount)) {
      await redis().hset(gameScoreboardKey(GAME_ID, playerId), category, '10')
    }
  }

  const phase = async (): Promise<string | null> => redis().hget(roomKey(ROOM_CODE), 'phase')

  it('한 명이라도 빈 칸이 있으면 끝내지 않는다', async () => {
    await seed()
    await fillScoreboard(PLAYERS[0], 12)
    await fillScoreboard(PLAYERS[1], 11)

    expect(await store().finishIfComplete(ROOM_CODE, GAME_ID, false)).toBe(false)
    expect(await phase()).toBe('PLAYING')
  })

  it('전원이 12칸을 채우면 끝낸다', async () => {
    await seed()
    for (const playerId of PLAYERS) await fillScoreboard(playerId, 12)

    expect(await store().finishIfComplete(ROOM_CODE, GAME_ID, false)).toBe(true)
    expect(await phase()).toBe('FINISHED')
  })

  /** 메타 필드(`_` 접두)를 칸으로 세면 실제보다 빨리 끝난다. 그 경계를 고정한다. */
  it('메타 필드를 기록 칸으로 세지 않는다', async () => {
    await seed()
    for (const playerId of PLAYERS) {
      await fillScoreboard(playerId, 11)
      await redis().hset(
        gameScoreboardKey(GAME_ID, playerId),
        TOTAL_FIELD,
        '100',
        UPPER_SUBTOTAL_FIELD,
        '63',
      )
    }

    expect(await store().finishIfComplete(ROOM_CODE, GAME_ID, false)).toBe(false)
    expect(await phase()).toBe('PLAYING')
  })

  /** 라운드 상한 안전망: 타임아웃으로 빈 칸이 남아도 종료할 수 있어야 한다. */
  it('force면 빈 칸이 있어도 끝낸다', async () => {
    await seed()

    expect(await store().finishIfComplete(ROOM_CODE, GAME_ID, true)).toBe(true)
    expect(await phase()).toBe('FINISHED')
  })

  /**
   * 동시에 여러 호출이 들어와도 true는 한 번만 나와야 한다 — 이 보장이 곧
   * `game.over` 중복 방송 불가다. Java는 스레드 8개, 여기서는 **연결 8개**로 건다
   * (한 연결에 보내면 파이프라인이 직렬화돼 경합이 사라진다).
   */
  it('동시 8건 중 한 호출만 전이한다', async () => {
    await seed()
    for (const playerId of PLAYERS) await fillScoreboard(playerId, 12)

    // 재시도를 끈다 — 테스트가 끝나고 서버가 내려간 뒤 재접속을 시도하면
    // 스위트 밖에서 ENOENT가 튄다.
    const clients = Array.from({ length: 8 }, () =>
      redis().duplicate({ retryStrategy: () => null }),
    )
    try {
      await Promise.all(clients.map(async (client) => client.ping()))
      const results = await Promise.all(
        clients.map(async (client) =>
          new RedisGameCompletionStore(client).finishIfComplete(ROOM_CODE, GAME_ID, false),
        ),
      )

      expect(results.filter(Boolean)).toHaveLength(1)
      expect(await phase()).toBe('FINISHED')
    } finally {
      for (const client of clients) client.disconnect()
    }
  })

  it('스테일 gameId는 무시한다', async () => {
    await seed()
    for (const playerId of PLAYERS) await fillScoreboard(playerId, 12)

    expect(await store().finishIfComplete(ROOM_CODE, 'other-game', false)).toBe(false)
    expect(await phase()).toBe('PLAYING')
  })

  it('빈 roomCode·gameId는 Redis를 건드리지 않고 false다', async () => {
    await seed()

    expect(await store().finishIfComplete('', GAME_ID, true)).toBe(false)
    expect(await store().finishIfComplete(ROOM_CODE, '  ', true)).toBe(false)
    expect(await phase()).toBe('PLAYING')
  })

  it('순위용 총점을 읽는다', async () => {
    await seed()
    await redis().hset(scoresKey(ROOM_CODE), PLAYERS[0], '180', PLAYERS[1], '205')

    const totals = await store().readTotals(ROOM_CODE)

    expect(totals.get(PLAYERS[0])).toBe(180)
    expect(totals.get(PLAYERS[1])).toBe(205)
  })

  it('숫자가 아닌 총점은 0으로 읽는다', async () => {
    await seed()
    await redis().hset(scoresKey(ROOM_CODE), PLAYERS[0], 'not-a-number')

    expect((await store().readTotals(ROOM_CODE)).get(PLAYERS[0])).toBe(0)
  })

  /**
   * 대기실 복귀에서 총점 초기화가 빠지면 다음 게임 순위에 지난 게임 점수가 얹힌다.
   * 총점 해시는 gameId가 아니라 **방**에 매달려 있어서 자동으로 비워지지 않는다.
   */
  it('로비 복귀가 총점을 초기화하고 새 게임을 허용한다', async () => {
    await seed()
    const rooms = new RoomService(redis())
    for (const playerId of PLAYERS) await fillScoreboard(playerId, 12)
    await redis().hset(scoresKey(ROOM_CODE), PLAYERS[0], '180')
    await store().finishIfComplete(ROOM_CODE, GAME_ID, false)

    expect(await rooms.returnToLobby(ROOM_CODE)).toBe(true)

    expect(await phase()).toBe('LOBBY')
    const totals = await store().readTotals(ROOM_CODE)
    expect([...totals.keys()].sort()).toEqual([...PLAYERS])
    expect([...totals.values()]).toEqual([0, 0])
    expect(await redis().hget(roomKey(ROOM_CODE), 'gameId')).toBeNull()
    // 되돌린 뒤에는 같은 멤버로 새 게임을 시작할 수 있어야 한다.
    expect((await rooms.startGame(ROOM_CODE)).gameId).not.toBe(GAME_ID)
  })

  it('진행 중인 게임은 로비 복귀를 거부한다', async () => {
    await seed()
    const rooms = new RoomService(redis())

    expect(await rooms.returnToLobby(ROOM_CODE)).toBe(false)
    expect(await phase()).toBe('PLAYING')
  })
})
