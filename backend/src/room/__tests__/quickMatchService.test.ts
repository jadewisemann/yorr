import type { Redis } from 'ioredis'
import { beforeEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { GAME_CATALOG, GameCatalog, type GameMetadata } from '../../game/catalog.js'
import { GameLifecycleService } from '../../game/lifecycle.js'
import type { UserIdentity } from '../../user/session.js'
import { UserService } from '../../user/session.js'
import { RoomSessionRegistry } from '../../ws/registry.js'
import type { ClientSocket } from '../../ws/socket.js'
import { roomKey } from '../keys.js'
import {
  QUICK_MATCH_WAIT_TTL_SECONDS,
  QuickMatchService,
  quickMatchMarkerKey,
  quickMatchQueueKey,
  quickMatchTicketKey,
} from '../quickMatchService.js'
import { RoomService } from '../roomService.js'

/**
 * 퀵매치 8종.
 *
 * **진짜 Redis + 진짜 `RoomService`/`UserService`/`RoomSessionRegistry`**를 쓴다.
 * 계약의 핵심(락·큐 순서·티켓 TTL·소켓 생존 판정)이 전부 모킹 불가한 부분이라
 * 그렇게 해야 의미가 있다(ADR-0004).
 *
 * `games.start`만 **기록하는 래퍼**로 감쌌다 — 호출 여부를 보면서도 진짜
 * `GameLifecycleService`에 위임하므로 phase 전이까지 함께 확인된다.
 */
const NEW_GAME: GameMetadata = {
  code: 'NEW_GAME',
  name: 'New Game',
  minPlayers: 3,
  maxPlayers: 4,
  supportsBots: false,
}

interface FakeSocket extends ClientSocket {
  readyState: number
}

const socket = (): FakeSocket => ({
  readyState: 1,
  send() {},
  close() {},
})

interface Harness {
  readonly matches: QuickMatchService
  readonly rooms: RoomService
  readonly users: UserService
  readonly registry: RoomSessionRegistry
  readonly started: string[]
}

describeRedis('퀵매치', () => {
  const redis = useRedis()
  let harness: Harness

  /** Java `setUp()` 자리. 카탈로그를 바꿔 끼우는 테스트만 인자를 넘긴다. */
  const build = (games: readonly GameMetadata[] = GAME_CATALOG): Harness => {
    const client = redis() as Redis
    const rooms = new RoomService(client)
    const users = new UserService(client)
    const catalog = new GameCatalog(games)
    const registry = new RoomSessionRegistry()
    const lifecycle = new GameLifecycleService(rooms, catalog)
    const started: string[] = []
    const matches = new QuickMatchService({
      redis: client,
      rooms,
      users,
      catalog,
      presence: registry,
      games: {
        start: async (roomCode) => {
          started.push(roomCode)
          return lifecycle.start(roomCode)
        },
      },
    })
    return { matches, rooms, users, registry, started }
  }

  /** Java `user(id, nickname)` — 세션 해시만 심는다(퀵매치가 읽는 것은 nickname·type뿐). */
  const user = async (userId: string, nickname: string): Promise<UserIdentity> => {
    await redis().hset(`user:${userId}`, { nickname, type: 'GUEST' })
    return { userId, nickname, type: 'GUEST' }
  }

  beforeEach(() => {
    harness = build()
  })

  it.each(['YACHT_DICE', 'PING_PONG', 'DUEL'])(
    '대기 중인 두 사람을 같은 게임 방으로 매칭한다 — %s',
    async (gameCode) => {
      const { matches, rooms } = harness
      const first = await user('player-a', 'A')
      const second = await user('player-b', 'B')

      expect((await matches.enter(first, gameCode)).status).toBe('WAITING')
      const secondResult = await matches.enter(second, gameCode)
      const firstResult = await matches.status(first.userId)

      expect(secondResult.status).toBe('MATCHED')
      expect(firstResult.roomId).toBe(secondResult.roomId)
      const room = await rooms.getSnapshot(firstResult.roomId as string)
      expect(room.gameCode).toBe(gameCode)
      expect(room.players).toHaveLength(2)
      // 최장 대기자가 방장이다.
      expect(room.hostId).toBe('player-a')
    },
  )

  it('게임이 다르면 큐도 다르다', async () => {
    const { matches } = harness
    const yachtPlayer = await user('player-a', 'A')
    const pingPongPlayer = await user('player-b', 'B')

    expect((await matches.enter(yachtPlayer, 'YACHT_DICE')).status).toBe('WAITING')
    expect((await matches.enter(pingPongPlayer, 'PING_PONG')).status).toBe('WAITING')
    expect(await redis().zrange(quickMatchQueueKey('YACHT_DICE'), 0, -1)).toEqual(['player-a'])
    expect(await redis().zrange(quickMatchQueueKey('PING_PONG'), 0, -1)).toEqual(['player-b'])
  })

  it('새 게임의 정원을 퀵매치 수정 없이 그대로 쓴다', async () => {
    harness = build([...GAME_CATALOG, NEW_GAME])
    const { matches, rooms } = harness

    expect((await matches.enter(await user('player-a', 'A'), 'NEW_GAME')).status).toBe('WAITING')
    expect((await matches.enter(await user('player-b', 'B'), 'NEW_GAME')).status).toBe('WAITING')
    const result = await matches.enter(await user('player-c', 'C'), 'NEW_GAME')

    expect(result.status).toBe('MATCHED')
    const room = await rooms.getSnapshot(result.roomId as string)
    expect(room.players).toHaveLength(3)
    // 정원은 매칭 인원(max(2, minPlayers))이지 maxPlayers가 아니다.
    expect(room.capacity).toBe(3)
  })

  it('대기 중이면 취소할 수 있다', async () => {
    const { matches } = harness
    const player = await user('player-a', 'A')
    await matches.enter(player, 'YACHT_DICE')

    expect((await matches.cancel(player.userId)).status).toBe('NOT_QUEUED')
    expect((await matches.status(player.userId)).status).toBe('NOT_QUEUED')
    expect(await redis().zrange(quickMatchQueueKey('YACHT_DICE'), 0, -1)).toEqual([])
  })

  it('방을 떠나면 직전 매칭 티켓도 사라진다', async () => {
    const { matches, users } = harness
    const first = await user('player-a', 'A')
    const second = await user('player-b', 'B')
    await matches.enter(first, 'YACHT_DICE')
    await matches.enter(second, 'YACHT_DICE')

    // clearRoom이 quick-match:user:{id}까지 지우는 것이 계약이다(1.2).
    await users.clearRoom(first.userId)

    expect((await matches.status(first.userId)).status).toBe('NOT_QUEUED')
    expect(await redis().exists(quickMatchTicketKey(first.userId))).toBe(0)
  })

  it('PLAYING을 한 번 보고하면 티켓을 소비한다', async () => {
    const { matches, rooms } = harness
    const first = await user('player-a', 'A')
    const second = await user('player-b', 'B')
    await matches.enter(first, 'YACHT_DICE')
    const roomId = (await matches.enter(second, 'YACHT_DICE')).roomId as string
    await rooms.startGame(roomId, 2)

    expect((await matches.status(first.userId)).status).toBe('PLAYING')
    expect((await matches.status(first.userId)).status).toBe('NOT_QUEUED')
    // 이미 PLAYING인 방의 자동 시작 마커는 폴링이 걷어낸다.
    expect(await redis().exists(quickMatchMarkerKey(roomId))).toBe(0)
  })

  it('FINISHED로 끝난 직전 매칭이 새 매칭을 막지 않는다', async () => {
    const { matches, rooms } = harness
    const first = await user('player-a', 'A')
    const second = await user('player-b', 'B')
    await matches.enter(first, 'YACHT_DICE')
    const oldRoomId = (await matches.enter(second, 'YACHT_DICE')).roomId as string
    await redis().hset(roomKey(oldRoomId), 'phase', 'FINISHED')

    expect((await matches.enter(first, 'YACHT_DICE')).status).toBe('WAITING')
    const oldRoom = await rooms.getSnapshot(oldRoomId)
    expect(oldRoom.players.map((player) => player.playerId)).not.toContain(first.userId)
  })

  it('매칭된 두 사람의 WS 소켓이 모두 붙은 뒤에야 시작한다', async () => {
    const { matches, rooms, registry, started } = harness
    const first = await user('player-a', 'A')
    const second = await user('player-b', 'B')
    await matches.enter(first, 'YACHT_DICE')
    const roomId = (await matches.enter(second, 'YACHT_DICE')).roomId as string
    registry.join(roomId, socket(), first.userId, first.nickname)

    // 한 명만 붙어 있으면 아무 일도 일어나지 않는다 — Redis 멤버십은 이미 2명이다.
    expect((await matches.status(first.userId)).status).toBe('MATCHED')
    expect(started).toEqual([])

    registry.join(roomId, socket(), second.userId, second.nickname)
    const afterBoth = await matches.status(first.userId)

    expect(started).toEqual([roomId])
    expect(afterBoth.status).toBe('PLAYING')
    expect((await rooms.getSnapshot(roomId)).phase).toBe('PLAYING')
    expect(await redis().exists(quickMatchMarkerKey(roomId))).toBe(0)
  })

  /* ── Java 테스트에 없던 회귀 방어 ─────────────────────────────────────── */

  it('닫히는 중인 소켓은 라이브가 아니다', async () => {
    const { matches, registry, started } = harness
    const first = await user('player-a', 'A')
    const second = await user('player-b', 'B')
    await matches.enter(first, 'YACHT_DICE')
    const roomId = (await matches.enter(second, 'YACHT_DICE')).roomId as string
    registry.join(roomId, socket(), first.userId, first.nickname)
    const closing = socket()
    registry.join(roomId, closing, second.userId, second.nickname)
    closing.readyState = 2 // CLOSING — 명단에서는 아직 online이다

    expect((await matches.status(first.userId)).status).toBe('MATCHED')
    expect(started).toEqual([])
  })

  it('5분을 넘긴 대기자는 매칭 시도 때 큐에서 청소된다', async () => {
    const client = redis() as Redis
    const rooms = new RoomService(client)
    const catalog = new GameCatalog()
    let now = Date.now()
    const matches = new QuickMatchService(
      {
        redis: client,
        rooms,
        users: new UserService(client),
        catalog,
        presence: new RoomSessionRegistry(),
        games: { start: async () => undefined },
      },
      { now: () => now },
    )
    const stale = await user('player-a', 'A')
    await matches.enter(stale, 'YACHT_DICE')

    now += (QUICK_MATCH_WAIT_TTL_SECONDS + 1) * 1000
    const second = await user('player-b', 'B')

    // 만료된 대기자와는 짝이 되지 않는다.
    expect((await matches.enter(second, 'YACHT_DICE')).status).toBe('WAITING')
    expect(await client.zrange(quickMatchQueueKey('YACHT_DICE'), 0, -1)).toEqual(['player-b'])
  })

  it('세션이 만료된 대기자는 퇴출되고 그 판은 성립하지 않는다', async () => {
    const { matches } = harness
    const ghost = await user('player-a', 'A')
    const alive = await user('player-b', 'B')
    await matches.enter(ghost, 'YACHT_DICE')
    await redis().del(`user:${ghost.userId}`)

    expect((await matches.enter(alive, 'YACHT_DICE')).status).toBe('WAITING')
    expect(await redis().zrange(quickMatchQueueKey('YACHT_DICE'), 0, -1)).toEqual(['player-b'])
    expect(await redis().exists(quickMatchTicketKey(ghost.userId))).toBe(0)
  })

  it('enter는 멱등이다 — 두 번 눌러도 큐는 한 줄이다', async () => {
    const { matches } = harness
    const player = await user('player-a', 'A')

    expect((await matches.enter(player, 'YACHT_DICE')).status).toBe('WAITING')
    expect((await matches.enter(player, 'YACHT_DICE')).status).toBe('WAITING')
    expect(await redis().zrange(quickMatchQueueKey('YACHT_DICE'), 0, -1)).toEqual(['player-a'])
  })

  it('이미 방에 있으면 already_in_room이다', async () => {
    const { matches, users } = harness
    const player = await user('player-a', 'A')
    await users.assignRoom(player.userId, 'ABC123', 'ABC123', player.userId)

    await expect(matches.enter(player, 'YACHT_DICE')).rejects.toMatchObject({
      code: 'already_in_room',
    })
  })

  it('정원보다 많은 인원이 필요한 게임은 큐를 열지 않는다', async () => {
    harness = build([
      ...GAME_CATALOG,
      { code: 'SOLO_ONLY', name: 'Solo', minPlayers: 3, maxPlayers: 2, supportsBots: false },
    ])

    await expect(
      harness.matches.enter(await user('player-a', 'A'), 'SOLO_ONLY'),
    ).rejects.toMatchObject({ code: 'quick_match_not_supported' })
  })
})
