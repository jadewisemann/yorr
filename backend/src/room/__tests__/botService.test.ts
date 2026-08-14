import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { ConflictError, DomainError } from '../../errors.js'
import { runLuaNumber } from '../../infra/lua.js'
import type { UserIdentity } from '../../user/session.js'
import { BotParticipantService, ForbiddenError } from '../botService.js'
import { botsKey, playersKey, roomKey, roomKeyFamily, scoresKey } from '../keys.js'
import { RoomService } from '../roomService.js'
import { BOT_ADD } from '../scripts.js'

const guest = (userId: string, nickname: string): UserIdentity => ({
  userId,
  nickname,
  type: 'GUEST',
})

const HOST = guest('player-1', '호스트')
const GUEST_2 = guest('player-2', '참가자')
const DASHBOARD = 'dashboard-1'

/**
 * 봇 참가자 — backend-java `BotParticipantServiceTest`.
 *
 * Java 쪽은 Lua **텍스트**를 문자열로 대조하는 테스트였다. 텍스트는 이식하면서
 * 이미 1:1로 옮겼으므로, 여기서는 그 텍스트가 지키려던 **동작**(검증 순서·세 키
 * 동시 기록·봇만 삭제)을 진짜 Redis로 확인한다 — 조건 하나가 빠져도 텍스트
 * 비교는 통과할 수 있지만 이건 통과하지 못한다.
 */
describeRedis('BotParticipantService — 추가', () => {
  const redis = useRedis()
  const services = (): { rooms: RoomService; bots: BotParticipantService } => {
    const rooms = new RoomService(redis())
    return { rooms, bots: new BotParticipantService(redis(), rooms) }
  }

  const givenLobby = async (
    capacity = 6,
  ): Promise<{ roomCode: string } & ReturnType<typeof services>> => {
    const service = services()
    const roomCode = await service.rooms.createRoom(capacity, HOST.userId, 'YACHT_DICE')
    await service.rooms.join(roomCode, HOST)
    return { roomCode, ...service }
  }

  it('봇은 명단·점수·봇 마커에 함께 기록되고 인원을 채운다', async () => {
    const { roomCode, bots } = await givenLobby()

    const snapshot = await bots.add(roomCode, HOST.userId)

    const bot = snapshot.players.find((player) => player.kind === 'BOT')
    expect(bot).toBeDefined()
    expect(bot?.score).toBe(0)
    expect(await redis().hget(playersKey(roomCode), bot?.playerId as string)).toBe(bot?.nickname)
    expect(await redis().hget(scoresKey(roomCode), bot?.playerId as string)).toBe('0')
    expect(await redis().hget(botsKey(roomCode), bot?.playerId as string)).toBe('BOT')
    expect(await redis().hget(roomKey(roomCode), 'members')).toBe('2')
  })

  it('봇 id는 bot-, 이름은 「요르봇 」 + id 끝 4자 대문자다', async () => {
    const { roomCode, bots } = await givenLobby()

    const snapshot = await bots.add(roomCode, HOST.userId)

    const botId = snapshot.players.find((player) => player.kind === 'BOT')?.playerId ?? ''
    expect(botId).toMatch(/^bot-[0-9a-f-]{36}$/)
    expect(snapshot.players.find((player) => player.kind === 'BOT')?.nickname).toBe(
      `요르봇 ${botId.slice(-4).toUpperCase()}`,
    )
  })

  it('봇을 추가해도 방 키 가족의 만료가 어긋나지 않는다', async () => {
    const { roomCode, bots } = await givenLobby()

    await bots.add(roomCode, HOST.userId)

    const roomTtl = await redis().pttl(roomKey(roomCode))
    for (const key of [playersKey(roomCode), scoresKey(roomCode), botsKey(roomCode)]) {
      expect(await redis().pttl(key)).toBeLessThanOrEqual(roomTtl)
      expect(await redis().pttl(key)).toBeGreaterThan(roomTtl - 1000)
    }
  })

  it('없는 방에는 봇을 넣을 수 없다', async () => {
    const { bots } = services()
    await expect(bots.add('NOPE12', HOST.userId)).rejects.toThrow(new DomainError('room_not_found'))
  })

  it('대기실이 아니면 lobby_only', async () => {
    const { roomCode, rooms, bots } = await givenLobby()
    await rooms.startGame(roomCode)

    await expect(bots.add(roomCode, HOST.userId)).rejects.toThrow(new ConflictError('lobby_only'))
  })

  it('방장이 아니면·명단 밖이면 host_only', async () => {
    const { roomCode, rooms, bots } = await givenLobby()
    await rooms.join(roomCode, GUEST_2)

    // hostId가 다른 사람
    await expect(bots.add(roomCode, GUEST_2.userId)).rejects.toThrow(
      new ForbiddenError('host_only'),
    )
    // hostId는 맞지만 명단 밖(방을 떠난 옛 방장)
    await rooms.leave(roomCode, HOST.userId)
    await redis().hset(roomKey(roomCode), 'hostId', HOST.userId)
    await expect(bots.add(roomCode, HOST.userId)).rejects.toThrow(new ForbiddenError('host_only'))
  })

  it('정원이 차면 room_full — 봇도 사람과 같은 좌석을 쓴다', async () => {
    const { roomCode, rooms, bots } = await givenLobby(2)

    await bots.add(roomCode, HOST.userId)

    await expect(bots.add(roomCode, HOST.userId)).rejects.toThrow(new ConflictError('room_full'))
    // 사람에게도 자리가 없다
    await expect(rooms.join(roomCode, GUEST_2)).rejects.toThrow(new ConflictError('room_full'))
  })

  it('botId가 이미 있으면 bot_operation_failed(반환 5)', async () => {
    const { roomCode, bots } = await givenLobby()
    const snapshot = await bots.add(roomCode, HOST.userId)
    const botId = snapshot.players.find((player) => player.kind === 'BOT')?.playerId as string

    // add()는 UUID를 새로 뽑으므로 중복 경로는 스크립트를 직접 불러 고정한다.
    const result = await runLuaNumber(redis(), BOT_ADD, roomKeyFamily(roomCode), [
      HOST.userId,
      botId,
      '요르봇 중복',
      'BOT',
    ])

    expect(result).toBe(5)
    expect(await redis().hget(roomKey(roomCode), 'members')).toBe('2')
  })
})

describeRedis('BotParticipantService — 삭제', () => {
  const redis = useRedis()
  const services = (): { rooms: RoomService; bots: BotParticipantService } => {
    const rooms = new RoomService(redis())
    return { rooms, bots: new BotParticipantService(redis(), rooms) }
  }

  const givenRoomWithBot = async (): Promise<{
    roomCode: string
    botId: string
    rooms: RoomService
    bots: BotParticipantService
  }> => {
    const { rooms, bots } = services()
    const roomCode = await rooms.createRoom(6, HOST.userId, 'YACHT_DICE')
    await rooms.join(roomCode, HOST)
    const snapshot = await bots.add(roomCode, HOST.userId)
    const botId = snapshot.players.find((player) => player.kind === 'BOT')?.playerId as string
    return { roomCode, botId, rooms, bots }
  }

  it('봇을 지우면 세 키에서 함께 빠지고 인원이 준다', async () => {
    const { roomCode, botId, bots } = await givenRoomWithBot()

    const snapshot = await bots.remove(roomCode, HOST.userId, botId)

    expect(snapshot.players.map((player) => player.playerId)).toEqual([HOST.userId])
    expect(await redis().hexists(playersKey(roomCode), botId)).toBe(0)
    expect(await redis().hexists(scoresKey(roomCode), botId)).toBe(0)
    expect(await redis().hexists(botsKey(roomCode), botId)).toBe(0)
    expect(await redis().hget(roomKey(roomCode), 'members')).toBe('1')
  })

  it('사람은 이 API로 쫓아낼 수 없다 — bot_not_found이고 명단도 그대로다', async () => {
    const { roomCode, rooms, bots } = await givenRoomWithBot()
    await rooms.join(roomCode, GUEST_2)

    await expect(bots.remove(roomCode, HOST.userId, GUEST_2.userId)).rejects.toThrow(
      new ConflictError('bot_not_found'),
    )

    expect(await redis().hexists(playersKey(roomCode), GUEST_2.userId)).toBe(1)
    expect(await redis().hexists(scoresKey(roomCode), GUEST_2.userId)).toBe(1)
    expect(await redis().hget(roomKey(roomCode), 'members')).toBe('3')
  })

  it('없는 봇도 bot_not_found', async () => {
    const { roomCode, bots } = await givenRoomWithBot()
    await expect(bots.remove(roomCode, HOST.userId, 'bot-없음')).rejects.toThrow(
      new ConflictError('bot_not_found'),
    )
  })

  it('없는 방·대기실 아님·방장 아님은 추가와 같은 코드로 막힌다', async () => {
    const { roomCode, botId, rooms, bots } = await givenRoomWithBot()
    await rooms.join(roomCode, GUEST_2)

    await expect(bots.remove('NOPE12', HOST.userId, botId)).rejects.toThrow(
      new DomainError('room_not_found'),
    )
    await expect(bots.remove(roomCode, GUEST_2.userId, botId)).rejects.toThrow(
      new ForbiddenError('host_only'),
    )

    await rooms.startGame(roomCode)
    await expect(bots.remove(roomCode, HOST.userId, botId)).rejects.toThrow(
      new ConflictError('lobby_only'),
    )
  })
})

/**
 * 파티 방·방장 승계와 봇의 관계 — backend-java `PartyRoomIntegrationTest`의 봇 케이스.
 * 봇 추가 권한이 "지금 명단 안의 방장"에게만 있고, 봇은 그 자리를 물려받지 못한다.
 */
describeRedis('BotParticipantService — 파티 방과 방장 승계', () => {
  const redis = useRedis()
  const CONTROLLER = guest('phone-1', '폰1')
  const CONTROLLER_2 = guest('phone-2', '폰2')
  const services = (): { rooms: RoomService; bots: BotParticipantService } => {
    const rooms = new RoomService(redis())
    return { rooms, bots: new BotParticipantService(redis(), rooms) }
  }

  it('처음 들어온 컨트롤러가 방장이 되어 봇을 붙일 수 있다', async () => {
    const { rooms, bots } = services()
    const roomCode = await rooms.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await rooms.join(roomCode, CONTROLLER)

    await bots.add(roomCode, CONTROLLER.userId)

    expect(await redis().hlen(botsKey(roomCode))).toBe(1)
  })

  it('대시보드는 파티 방을 조작할 수 없다', async () => {
    const { rooms, bots } = services()
    const roomCode = await rooms.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await rooms.join(roomCode, CONTROLLER)

    await expect(bots.add(roomCode, DASHBOARD)).rejects.toThrow(new ForbiddenError('host_only'))
  })

  it('일반 방에서도 명단 밖 방장은 조작할 수 없다', async () => {
    const { rooms, bots } = services()
    const roomCode = await rooms.createRoom(6, DASHBOARD, 'YACHT_DICE')

    await expect(bots.add(roomCode, DASHBOARD)).rejects.toThrow(new ForbiddenError('host_only'))
  })

  it('방장이 아닌 컨트롤러는 조작할 수 없다', async () => {
    const { rooms, bots } = services()
    const roomCode = await rooms.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await rooms.join(roomCode, CONTROLLER)
    await rooms.join(roomCode, CONTROLLER_2)

    await expect(bots.add(roomCode, CONTROLLER_2.userId)).rejects.toThrow(
      new ForbiddenError('host_only'),
    )
  })

  it('방장이 나가면 승계받은 사람이 봇을 붙인다', async () => {
    const { rooms, bots } = services()
    const roomCode = await rooms.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await rooms.join(roomCode, CONTROLLER)
    await rooms.join(roomCode, CONTROLLER_2)

    await rooms.leave(roomCode, CONTROLLER.userId)

    expect((await rooms.getSnapshot(roomCode)).hostId).toBe(CONTROLLER_2.userId)
    await bots.add(roomCode, CONTROLLER_2.userId)
    expect(await redis().hlen(botsKey(roomCode))).toBe(1)
  })

  it('봇은 방장을 이어받지 못한다 — 사람이 다 나가면 자리가 빈 채로 남는다', async () => {
    const { rooms, bots } = services()
    const roomCode = await rooms.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await rooms.join(roomCode, CONTROLLER)
    await bots.add(roomCode, CONTROLLER.userId)

    await rooms.leave(roomCode, CONTROLLER.userId)

    const snapshot = await rooms.getSnapshot(roomCode)
    expect(snapshot.players).toHaveLength(1)
    expect(snapshot.players[0]?.kind).toBe('BOT')
    expect(snapshot.hostId).toBe('')
  })
})
