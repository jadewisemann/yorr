import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { ConflictError, DomainError } from '../../errors.js'
import type { UserIdentity } from '../../user/session.js'
import {
  botsKey,
  gameKey,
  gameScoreboardKey,
  gameScoreSubmissionsKey,
  playersKey,
  roomKey,
  scoresKey,
} from '../keys.js'
import { ROOM_TTL_SECONDS, RoomService } from '../roomService.js'

const guest = (userId: string, nickname: string): UserIdentity => ({
  userId,
  nickname,
  type: 'GUEST',
})

const HOST = guest('player-1', '호스트')
const GUEST_2 = guest('player-2', '참가자')
const DASHBOARD = 'dashboard-1'

describeRedis('RoomService', () => {
  const redis = useRedis()
  const rooms = (): RoomService => new RoomService(redis())

  it('방 코드는 대문자·숫자 6자다', async () => {
    const roomCode = await rooms().createRoom(6, HOST.userId, 'YACHT_DICE')
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('생성된 방은 LOBBY·정원·모드·40분 TTL을 갖는다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')

    const room = await redis().hgetall(roomKey(roomCode))
    expect(room).toMatchObject({
      capacity: '6',
      members: '0',
      phase: 'LOBBY',
      hostId: HOST.userId,
      gameCode: 'YACHT_DICE',
      mode: 'NORMAL',
    })
    expect(await redis().ttl(roomKey(roomCode))).toBeGreaterThan(ROOM_TTL_SECONDS - 5)
  })

  it('정원은 1 이상, 게임 코드는 비어 있을 수 없다', async () => {
    const service = rooms()
    await expect(service.createRoom(0, HOST.userId, 'YACHT_DICE')).rejects.toThrow(
      new DomainError('invalid_capacity'),
    )
    await expect(service.createRoom(6, HOST.userId, ' ')).rejects.toThrow(
      new DomainError('invalid_game_code'),
    )
  })

  it('방 목록은 자식 키를 세지 않는다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)

    expect(await service.getAllRoomCodes()).toEqual([roomCode])
  })

  it('없는 방에는 들어갈 수 없다', async () => {
    await expect(rooms().join('NOPE12', HOST)).rejects.toThrow(new DomainError('room_not_found'))
  })

  it('시작된 방·정원이 찬 방은 거절한다', async () => {
    const service = rooms()
    const full = await service.createRoom(1, HOST.userId, 'YACHT_DICE')
    await service.join(full, HOST)
    await expect(service.join(full, GUEST_2)).rejects.toThrow(new ConflictError('room_full'))

    const playing = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(playing, HOST)
    await service.startGame(playing)
    await expect(service.join(playing, GUEST_2)).rejects.toThrow(new ConflictError('game_started'))
  })

  it('같은 사람이 다시 들어와도 인원이 늘지 않는다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)

    const snapshot = await service.join(roomCode, HOST)

    expect(snapshot.players).toHaveLength(1)
    expect(await redis().hget(roomKey(roomCode), 'members')).toBe('1')
  })

  it('참가 시 자식 키의 만료가 방 키에 맞춰진다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)

    const roomTtl = await redis().pttl(roomKey(roomCode))
    for (const key of [playersKey(roomCode), scoresKey(roomCode)]) {
      expect(await redis().pttl(key)).toBeLessThanOrEqual(roomTtl)
      expect(await redis().pttl(key)).toBeGreaterThan(roomTtl - 1000)
    }
  })

  it('스냅샷은 playerId 순으로 정렬하고 봇을 구분한다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, GUEST_2)
    await service.join(roomCode, HOST)
    await redis().hset(playersKey(roomCode), 'bot-9', '요르봇 9')
    await redis().hset(botsKey(roomCode), 'bot-9', 'BOT')
    await redis().hset(scoresKey(roomCode), HOST.userId, '12')

    const snapshot = await service.getSnapshot(roomCode)

    expect(snapshot.players.map((player) => player.playerId)).toEqual([
      'bot-9',
      HOST.userId,
      GUEST_2.userId,
    ])
    expect(snapshot.players[0]?.kind).toBe('BOT')
    expect(snapshot.players[1]).toMatchObject({ kind: 'HUMAN', score: 12 })
    expect(snapshot).toMatchObject({
      roomCode,
      gameCode: 'YACHT_DICE',
      phase: 'LOBBY',
      capacity: 6,
    })
  })

  it('없는 방의 스냅샷은 전 필드 null이다', async () => {
    const snapshot = await rooms().getSnapshot('NOPE12')
    expect(snapshot.phase).toBeNull()
    expect(snapshot.players).toEqual([])
    expect(snapshot.capacity).toBe(0)
  })

  it('touch는 방 키 가족의 수명을 함께 민다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)
    for (const key of [roomKey(roomCode), playersKey(roomCode), scoresKey(roomCode)]) {
      await redis().expire(key, 60)
    }

    await service.touch(roomCode)

    for (const key of [roomKey(roomCode), playersKey(roomCode), scoresKey(roomCode)]) {
      expect(await redis().ttl(key)).toBeGreaterThan(60)
    }
  })

  it('없는 방을 touch·close해도 무해하다', async () => {
    const service = rooms()
    await expect(service.touch('NOPE12')).resolves.toBeUndefined()
    await expect(service.close('NOPE12')).resolves.toBeUndefined()
    expect(await redis().exists(roomKey('NOPE12'))).toBe(0)
  })
})

/**
 * 빈 방 닫기가 **정말로** 키를 남기지 않는지 확인한다. 게임 키는 Lua 안에서
 * 이름을 조립하므로 규약이 어긋나면 조용히 남는다 — 그걸 잡는 테스트다.
 */
describeRedis('RoomService.close', () => {
  const redis = useRedis()
  const ROOM_CODE = 'ROOM9'
  const GAME_ID = 'game-9'

  const givenPlayingRoom = async (): Promise<void> => {
    await redis().hset(roomKey(ROOM_CODE), {
      capacity: '6',
      members: '2',
      phase: 'PLAYING',
      hostId: HOST.userId,
      gameId: GAME_ID,
    })
    await redis().hset(playersKey(ROOM_CODE), {
      [HOST.userId]: '호스트',
      [GUEST_2.userId]: '참가자',
    })
    await redis().hset(scoresKey(ROOM_CODE), { [HOST.userId]: '12', [GUEST_2.userId]: '8' })
    await redis().hset(botsKey(ROOM_CODE), GUEST_2.userId, 'NORMAL')
    await redis().hset(gameKey(GAME_ID), 'roomCode', ROOM_CODE)
    for (const player of [HOST.userId, GUEST_2.userId]) {
      await redis().hset(gameScoreboardKey(GAME_ID, player), 'choice', '12')
      await redis().hset(gameScoreSubmissionsKey(GAME_ID, player), '1', 'choice:1,2,3,4,5')
    }
  }

  it('진행 중인 방의 모든 키를 지운다', async () => {
    await givenPlayingRoom()

    await new RoomService(redis()).close(ROOM_CODE)

    for (const key of [
      roomKey(ROOM_CODE),
      playersKey(ROOM_CODE),
      scoresKey(ROOM_CODE),
      botsKey(ROOM_CODE),
      gameKey(GAME_ID),
      gameScoreboardKey(GAME_ID, HOST.userId),
      gameScoreSubmissionsKey(GAME_ID, HOST.userId),
      gameScoreboardKey(GAME_ID, GUEST_2.userId),
      gameScoreSubmissionsKey(GAME_ID, GUEST_2.userId),
    ]) {
      expect(await redis().exists(key)).toBe(0)
    }
  })

  it('게임을 시작한 적 없는 대기실도 지운다', async () => {
    await redis().hset(roomKey(ROOM_CODE), {
      capacity: '6',
      members: '1',
      phase: 'LOBBY',
      hostId: HOST.userId,
    })
    await redis().hset(playersKey(ROOM_CODE), HOST.userId, '호스트')

    await new RoomService(redis()).close(ROOM_CODE)

    expect(await redis().exists(roomKey(ROOM_CODE))).toBe(0)
    expect(await redis().exists(playersKey(ROOM_CODE))).toBe(0)
  })

  it('다른 방은 건드리지 않는다', async () => {
    await givenPlayingRoom()
    await redis().hset(roomKey('OTHER'), { capacity: '6', members: '1', phase: 'LOBBY' })

    await new RoomService(redis()).close(ROOM_CODE)

    expect(await redis().exists(roomKey('OTHER'))).toBe(1)
  })
})

describeRedis('RoomService — 게임 시작·되돌리기', () => {
  const redis = useRedis()
  const rooms = (): RoomService => new RoomService(redis())

  /** 호스트 혼자 들어와 게임을 시작한 방. 되돌리기 검사들이 여기서 출발한다. */
  const givenStartedRoom = async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)
    const { gameId } = await service.startGame(roomCode)
    return { service, roomCode, gameId }
  }

  it('시작하면 PLAYING·gameId·game 키가 생긴다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)

    const { gameId, snapshot } = await service.startGame(roomCode)

    expect(snapshot.phase).toBe('PLAYING')
    expect(snapshot.gameId).toBe(gameId)
    expect(await redis().hgetall(gameKey(gameId))).toEqual({
      roomCode,
      gameCode: 'YACHT_DICE',
    })
  })

  it('인원이 모자라면 시작 실패는 game_not_ready 하나로 뭉개진다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'DUEL')
    await service.join(roomCode, HOST)

    await expect(service.startGame(roomCode, 2)).rejects.toThrow(
      new ConflictError('game_not_ready'),
    )
    // 없는 방도, 이미 시작한 방도 같은 오류다
    await expect(service.startGame('NOPE12')).rejects.toThrow(new ConflictError('game_not_ready'))
    await service.startGame(roomCode)
    await expect(service.startGame(roomCode)).rejects.toThrow(new ConflictError('game_not_ready'))
  })

  it('봇도 시작 인원을 채운다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)
    await redis().hset(playersKey(roomCode), 'bot-9', '요르봇 9')
    await redis().hset(botsKey(roomCode), 'bot-9', 'BOT')

    await expect(service.startGame(roomCode, 2)).resolves.toMatchObject({
      snapshot: { phase: 'PLAYING' },
    })
  })

  it('롤백은 자기 게임만 되돌린다', async () => {
    const { service, roomCode, gameId } = await givenStartedRoom()

    expect(await service.rollbackStart(roomCode, 'another-game')).toBe(false)
    expect((await service.getSnapshot(roomCode)).phase).toBe('PLAYING')

    expect(await service.rollbackStart(roomCode, gameId)).toBe(true)
    const snapshot = await service.getSnapshot(roomCode)
    expect(snapshot.phase).toBe('LOBBY')
    expect(snapshot.gameId).toBeNull()
    expect(await redis().exists(gameKey(gameId))).toBe(0)
  })

  it('준비 단계 취소는 방을 다시 열고 게임 키를 지운다', async () => {
    const { service, roomCode, gameId } = await givenStartedRoom()

    expect(await service.cancelActiveGame(roomCode)).toBe(true)

    expect((await service.getSnapshot(roomCode)).phase).toBe('LOBBY')
    expect(await redis().exists(gameKey(gameId))).toBe(0)
    // LOBBY인 방을 다시 취소해도 아무 일도 일어나지 않는다
    expect(await service.cancelActiveGame(roomCode)).toBe(false)
  })

  it('로비 복귀는 FINISHED에서만·총점을 0으로 되돌린다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)
    await service.join(roomCode, GUEST_2)
    const { gameId } = await service.startGame(roomCode)
    await redis().hset(scoresKey(roomCode), { [HOST.userId]: '120', [GUEST_2.userId]: '80' })

    expect(await service.returnToLobby(roomCode)).toBe(false) // 아직 PLAYING

    await redis().hset(roomKey(roomCode), 'phase', 'FINISHED')
    expect(await service.returnToLobby(roomCode)).toBe(true)

    const snapshot = await service.getSnapshot(roomCode)
    expect(snapshot.phase).toBe('LOBBY')
    expect(snapshot.gameId).toBeNull()
    expect(snapshot.players.map((player) => player.score)).toEqual([0, 0])
    // 점수판은 결과 조회용으로 남긴다
    expect(await redis().hget(gameKey(gameId), 'roomCode')).toBe(roomCode)
  })

  it('gameId로도 방 스냅샷을 찾는다', async () => {
    const { service, roomCode, gameId } = await givenStartedRoom()

    expect((await service.getGameSnapshot(gameId)).roomCode).toBe(roomCode)
    expect(await service.getGameSnapshot('없는-게임')).toMatchObject({
      roomCode: null,
      phase: null,
    })
  })
})

/**
 * 파티 방(대시보드)의 전제 — 방을 연 대시보드는 플레이어도 방장도 아니고,
 * 방장은 처음 들어온 컨트롤러가 이어받는다. 둘 다 Lua 안에 있어 조건이 어긋나도
 * 컴파일로는 잡히지 않는다.
 */
describeRedis('RoomService — 파티 방과 방장 승계', () => {
  const redis = useRedis()
  const rooms = (): RoomService => new RoomService(redis())
  const CONTROLLER = guest('phone-1', '폰1')
  const CONTROLLER_2 = guest('phone-2', '폰2')

  it('파티 방은 플레이어 없이 시작한다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')

    expect(await service.isPartyRoom(roomCode)).toBe(true)
    expect((await service.getSnapshot(roomCode)).players).toEqual([])
  })

  it('일반 방은 파티 방이 아니다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, DASHBOARD, 'YACHT_DICE')
    expect(await service.isPartyRoom(roomCode)).toBe(false)
  })

  it('처음 들어온 컨트롤러가 방장을 이어받는다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')

    const snapshot = await service.join(roomCode, CONTROLLER)

    expect(snapshot.players.map((player) => player.playerId)).toEqual([CONTROLLER.userId])
    expect(snapshot.hostId).toBe(CONTROLLER.userId)
  })

  it('뒤에 들어온 컨트롤러는 방장을 빼앗지 않는다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await service.join(roomCode, CONTROLLER)

    const snapshot = await service.join(roomCode, CONTROLLER_2)

    expect(snapshot.hostId).toBe(CONTROLLER.userId)
  })

  it('마지막 컨트롤러가 나가도 파티 방은 남는다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await service.join(roomCode, CONTROLLER)

    expect(await service.leave(roomCode, CONTROLLER.userId)).toBe(true)

    const snapshot = await service.getSnapshot(roomCode)
    expect(snapshot.phase).not.toBeNull()
    expect(snapshot.players).toEqual([])
    expect(await service.isPartyRoom(roomCode)).toBe(true)
  })

  it('일반 방은 마지막 참가자가 나가면 사라진다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)

    await service.leave(roomCode, HOST.userId)

    expect((await service.getSnapshot(roomCode)).phase).toBeNull()
    expect(await redis().exists(playersKey(roomCode))).toBe(0)
  })

  it('없는 방·없는 좌석에서 나가면 false다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, HOST.userId, 'YACHT_DICE')
    await service.join(roomCode, HOST)

    expect(await service.leave('NOPE12', HOST.userId)).toBe(false)
    expect(await service.leave(roomCode, '누구세요')).toBe(false)
  })

  it('방장이 나가면 남은 사람이 이어받는다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, CONTROLLER.userId, 'YACHT_DICE')
    await service.join(roomCode, CONTROLLER)
    await service.join(roomCode, CONTROLLER_2)

    await service.leave(roomCode, CONTROLLER.userId)

    expect((await service.getSnapshot(roomCode)).hostId).toBe(CONTROLLER_2.userId)
  })

  it('봇은 방장을 이어받지 못한다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await service.join(roomCode, CONTROLLER)
    // 봇 추가는 1.6의 Lua다 — 여기서는 LEAVE의 승계 규칙만 검증하려고 직접 심는다.
    await redis().hset(playersKey(roomCode), 'bot-9', '요르봇 9')
    await redis().hset(botsKey(roomCode), 'bot-9', 'BOT')
    await redis().hincrby(roomKey(roomCode), 'members', 1)

    await service.leave(roomCode, CONTROLLER.userId)

    const snapshot = await service.getSnapshot(roomCode)
    expect(snapshot.players).toHaveLength(1)
    expect(snapshot.hostId).toBe('')
  })

  it('비어 있는 방장 자리는 다음 컨트롤러가 가져간다', async () => {
    const service = rooms()
    const roomCode = await service.createRoom(6, DASHBOARD, 'YACHT_DICE', 'PARTY')
    await service.join(roomCode, CONTROLLER)
    await service.leave(roomCode, CONTROLLER.userId)
    expect((await service.getSnapshot(roomCode)).hostId).toBe('')

    const snapshot = await service.join(roomCode, CONTROLLER_2)

    expect(snapshot.hostId).toBe(CONTROLLER_2.userId)
  })
})
