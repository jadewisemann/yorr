import fastify, { type FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { afterEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { GameCatalog } from '../../../game/catalog.js'
import { GameLifecycleService } from '../../../game/lifecycle.js'
import { BotParticipantService } from '../../../room/botService.js'
import { botsKey, roomKey } from '../../../room/keys.js'
import { RoomService } from '../../../room/roomService.js'
import type { RoomSnapshot } from '../../../room/snapshot.js'
import { UserService } from '../../../user/session.js'
import { RoomBroadcaster } from '../../../ws/broadcaster.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import { RealtimeRoomSnapshotService } from '../../../ws/snapshot.js'
import type { ClientSocket } from '../../../ws/socket.js'
import { registerRoomRoutes } from '../rooms.js'

interface FakeSocket extends ClientSocket {
  readyState: number
  readonly sent: string[]
}

const socket = (): FakeSocket => ({
  readyState: 1,
  sent: [],
  send(data: string) {
    this.sent.push(data)
  },
  close() {},
})

interface EnterRoomResponse {
  id: string
  nickname: string
  token: string
  room_id: string
  game_code: string | null
}

const authHeaders = (userId: string, token: string): Record<string, string> => ({
  'X-User-Id': userId,
  Authorization: `Bearer ${token}`,
})

/**
 * 봇 REST.
 *
 * 진짜 Redis와 진짜 브로드캐스터를 쓴다 — 계약의 절반이 Lua 반환 코드 →
 * 상태 코드 매핑이라
 * 모킹하면 그 매핑을 테스트가 스스로 정의해 버린다.
 *
 * 조립은 `server.ts`가 아니라 여기서 한다: 봇 라우트는 WS 게이트웨이와 **같은**
 * 브로드캐스터·스냅샷 인스턴스를 받아야 하고, 그 배선은 아직 조립부에 없다.
 */
describeRedis('봇 REST', () => {
  const redis = useRedis()
  let app: FastifyInstance | undefined

  const build = async (): Promise<{ app: FastifyInstance; broadcaster: RoomBroadcaster }> => {
    const client = redis() as Redis
    const rooms = new RoomService(client)
    const catalog = new GameCatalog()
    const registry = new RoomSessionRegistry()
    const broadcaster = new RoomBroadcaster()
    const instance = fastify({ logger: false })
    await instance.register(
      async (api) => {
        await registerRoomRoutes(api, {
          users: new UserService(client),
          rooms,
          catalog,
          lifecycle: new GameLifecycleService(rooms, catalog),
          bots: new BotParticipantService(client, rooms),
          broadcaster,
          snapshots: new RealtimeRoomSnapshotService(rooms, registry),
        })
      },
      { prefix: '/api/v1' },
    )
    await instance.ready()
    app = instance
    return { app: instance, broadcaster }
  }

  const enterRoom = async (
    instance: FastifyInstance,
    body: Record<string, unknown>,
    query = '',
  ): Promise<EnterRoomResponse> => {
    const response = await instance.inject({
      method: 'POST',
      url: `/api/v1/rooms${query}`,
      payload: body,
    })
    return response.json() as EnterRoomResponse
  }

  const addBot = (
    instance: FastifyInstance,
    roomCode: string,
    user: { id: string; token: string },
  ) =>
    instance.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomCode}/bots`,
      headers: authHeaders(user.id, user.token),
    })

  const removeBot = (
    instance: FastifyInstance,
    roomCode: string,
    botId: string,
    user: { id: string; token: string },
  ) =>
    instance.inject({
      method: 'DELETE',
      url: `/api/v1/rooms/${roomCode}/bots/${botId}`,
      headers: authHeaders(user.id, user.token),
    })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('POST — 봇을 넣고 방 스냅샷을 돌려주며 state.sync를 방송한다', async () => {
    const { app: instance, broadcaster } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })
    const listener = socket()
    broadcaster.register(host.room_id, listener)

    const response = await addBot(instance, host.room_id, host)

    expect(response.statusCode).toBe(200)
    const snapshot = response.json() as RoomSnapshot
    // 응답은 REST 스냅샷 모양이다(roomCode·대문자 phase·score) — WS 스냅샷과 다르다.
    expect(snapshot).toMatchObject({ roomCode: host.room_id, phase: 'LOBBY', capacity: 6 })
    const bot = snapshot.players.find((player) => player.kind === 'BOT')
    expect(bot?.nickname).toMatch(/^요르봇 /)

    expect(listener.sent).toHaveLength(1)
    const broadcastMessage = JSON.parse(listener.sent[0] as string)
    expect(broadcastMessage.type).toBe('state.sync')
    expect(broadcastMessage.roomId).toBe(host.room_id)
    // 방송에 실리는 것은 WS 스냅샷이다(phase 소문자, roomId, 봇은 항상 online)
    expect(broadcastMessage.payload.snapshot).toMatchObject({
      roomId: host.room_id,
      phase: 'waiting',
    })
    expect(
      broadcastMessage.payload.snapshot.players.find(
        (player: { playerId: string }) => player.playerId === bot?.playerId,
      ),
    ).toMatchObject({ kind: 'BOT', status: 'online' })
  })

  it('DELETE — 봇을 빼고 스냅샷을 돌려주며 다시 방송한다', async () => {
    const { app: instance, broadcaster } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })
    const added = (await addBot(instance, host.room_id, host)).json() as RoomSnapshot
    const botId = added.players.find((player) => player.kind === 'BOT')?.playerId as string
    const listener = socket()
    broadcaster.register(host.room_id, listener)

    const response = await removeBot(instance, host.room_id, botId, host)

    expect(response.statusCode).toBe(200)
    expect((response.json() as RoomSnapshot).players.map((player) => player.playerId)).toEqual([
      host.id,
    ])
    expect(await redis().hlen(botsKey(host.room_id))).toBe(0)
    expect(listener.sent).toHaveLength(1)
    expect(JSON.parse(listener.sent[0] as string).type).toBe('state.sync')
  })

  it('401은 invalid_guest_session이고 방은 그대로다', async () => {
    const { app: instance } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })

    const response = await addBot(instance, host.room_id, { id: host.id, token: '틀린-토큰' })

    expect(response.statusCode).toBe(401)
    expect(response.body).toBe('invalid_guest_session')
    expect(await redis().hlen(botsKey(host.room_id))).toBe(0)
  })

  it('방장이 아니면 403 host_only', async () => {
    const { app: instance, broadcaster } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })
    const guest = await enterRoom(instance, { nickname: '참가자', room_id: host.room_id })
    const added = (await addBot(instance, host.room_id, host)).json() as RoomSnapshot
    const botId = added.players.find((player) => player.kind === 'BOT')?.playerId as string
    const listener = socket()
    broadcaster.register(host.room_id, listener)

    const add = await addBot(instance, host.room_id, guest)
    const remove = await removeBot(instance, host.room_id, botId, guest)

    expect(add.statusCode).toBe(403)
    expect(add.body).toBe('host_only')
    expect(remove.statusCode).toBe(403)
    expect(remove.body).toBe('host_only')
    // 실패하면 방송도 없다
    expect(listener.sent).toHaveLength(0)
  })

  it('봇을 지원하지 않는 게임은 409 bots_not_supported', async () => {
    const { app: instance } = await build()
    const host = await enterRoom(instance, { nickname: '결투1' }, '?game_code=DUEL')

    const response = await addBot(instance, host.room_id, host)

    expect(response.statusCode).toBe(409)
    expect(response.body).toBe('bots_not_supported')
  })

  it('없는 방은 404가 아니라 400 invalid_game_code다(계약 동결된 quirk)', async () => {
    const { app: instance } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })

    const response = await addBot(instance, 'NOPE12', host)

    expect(response.statusCode).toBe(400)
    expect(response.body).toBe('invalid_game_code')
  })

  it('없는 봇을 지우면 404 bot_not_found', async () => {
    const { app: instance } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })

    const response = await removeBot(instance, host.room_id, 'bot-없음', host)

    expect(response.statusCode).toBe(404)
    expect(response.body).toBe('bot_not_found')
  })

  it('사람을 봇 삭제 API로 쫓아낼 수 없다', async () => {
    const { app: instance } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })
    const guest = await enterRoom(instance, { nickname: '참가자', room_id: host.room_id })

    const response = await removeBot(instance, host.room_id, guest.id, host)

    expect(response.statusCode).toBe(404)
    expect(response.body).toBe('bot_not_found')
    expect(
      (await new RoomService(redis() as Redis).getSnapshot(host.room_id)).players,
    ).toHaveLength(2)
  })

  it('게임이 시작된 방은 409 lobby_only', async () => {
    const { app: instance } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })
    await instance.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.room_id}/games`,
      headers: authHeaders(host.id, host.token),
    })

    const response = await addBot(instance, host.room_id, host)

    expect(response.statusCode).toBe(409)
    expect(response.body).toBe('lobby_only')
  })

  it('정원이 차면 409 room_full', async () => {
    const { app: instance } = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })
    await redis().hset(roomKey(host.room_id), 'capacity', '2')

    expect((await addBot(instance, host.room_id, host)).statusCode).toBe(200)
    const full = await addBot(instance, host.room_id, host)

    expect(full.statusCode).toBe(409)
    expect(full.body).toBe('room_full')
  })
})
