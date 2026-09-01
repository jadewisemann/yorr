import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { botsKey, playersKey } from '../../room/keys.js'
import { RoomService } from '../../room/roomService.js'
import type { UserIdentity } from '../../user/session.js'
import { RoomSessionRegistry } from '../registry.js'
import { RealtimeRoomSnapshotService } from '../snapshot.js'
import type { ClientSocket } from '../socket.js'

const guest = (userId: string, nickname: string): UserIdentity => ({
  userId,
  nickname,
  type: 'GUEST',
})

const socket = (): ClientSocket => ({ readyState: 1, send: () => {}, close: () => {} })

const HUMAN = guest('human-1', '사람')

describeRedis('RealtimeRoomSnapshotService', () => {
  const redis = useRedis()

  const openRoom = async (): Promise<{ rooms: RoomService; roomCode: string }> => {
    const rooms = new RoomService(redis())
    const roomCode = await rooms.createRoom(6, HUMAN.userId, 'YACHT_DICE')
    await rooms.join(roomCode, HUMAN)
    // 봇은 REST(1.6)가 넣는다 — 여기서는 roster에 직접 심어 병합만 검증한다.
    await redis().hset(playersKey(roomCode), 'bot-1', '요르봇')
    await redis().hset(botsKey(roomCode), 'bot-1', '1')
    return { rooms, roomCode }
  }

  it('Redis 명단과 소켓 접속 상태를 합친다 — 봇은 항상 online', async () => {
    const { rooms, roomCode } = await openRoom()
    const sessions = new RoomSessionRegistry()
    sessions.join(roomCode, socket(), HUMAN.userId, HUMAN.nickname)

    const snapshot = await new RealtimeRoomSnapshotService(rooms, sessions).snapshot(roomCode)

    expect(snapshot).toMatchObject({
      roomId: roomCode,
      gameCode: 'YACHT_DICE',
      phase: 'waiting',
      hostId: HUMAN.userId,
      capacity: 6,
    })
    expect(snapshot.players).toEqual([
      { playerId: 'bot-1', nickname: '요르봇', status: 'online', isHost: false, kind: 'BOT' },
      {
        playerId: HUMAN.userId,
        nickname: HUMAN.nickname,
        status: 'online',
        isHost: true,
        kind: 'HUMAN',
      },
    ])
  })

  it('Redis에는 있지만 소켓이 없는 사람은 offline이다', async () => {
    const { rooms, roomCode } = await openRoom()

    const snapshot = await new RealtimeRoomSnapshotService(
      rooms,
      new RoomSessionRegistry(),
    ).snapshot(roomCode)

    expect(snapshot.players.map((player) => [player.playerId, player.status])).toEqual([
      ['bot-1', 'online'],
      [HUMAN.userId, 'offline'],
    ])
  })

  it('게임이 시작된 방은 playing으로 내려간다', async () => {
    const { rooms, roomCode } = await openRoom()
    await rooms.startGame(roomCode, 1)

    const snapshot = await new RealtimeRoomSnapshotService(
      rooms,
      new RoomSessionRegistry(),
    ).snapshot(roomCode)

    expect(snapshot.phase).toBe('playing')
  })

  /** 방이 이미 사라졌으면 인메모리 명단만으로 답한다. */
  it('사라진 방은 레지스트리 스냅샷으로 대체된다', async () => {
    const rooms = new RoomService(redis())
    const sessions = new RoomSessionRegistry()
    sessions.join('GONE01', socket(), 'player-1', '유령')

    const snapshot = await new RealtimeRoomSnapshotService(rooms, sessions).snapshot('GONE01')

    expect(snapshot).toMatchObject({ roomId: 'GONE01', phase: 'waiting' })
    expect(snapshot.players).toHaveLength(1)
    expect(snapshot.capacity).toBeUndefined()
  })
})
