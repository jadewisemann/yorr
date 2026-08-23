import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { ConflictError, DomainError } from '../../errors.js'
import { gameKey, roomKey } from '../../room/keys.js'
import { type GameStartResult, RoomService } from '../../room/roomService.js'
import type { UserIdentity } from '../../user/session.js'
import { DUEL, GameCatalog, YACHT_DICE } from '../catalog.js'
import { GameLifecycleService } from '../lifecycle.js'
import { type GameModule, GameModuleRegistry } from '../module.js'

const guest = (userId: string, nickname: string): UserIdentity => ({
  userId,
  nickname,
  type: 'GUEST',
})

const HOST = guest('player-1', '호스트')
const GUEST_2 = guest('player-2', '참가자')

interface RecordingModule {
  readonly module: GameModule
  readonly started: { roomCode: string; game: GameStartResult }[]
  readonly calls: string[]
}

/** 라이프사이클이 부르는 훅만 기록하는 모듈(Java 테스트의 `mock(GameModule.class)`). */
const recordingModule = (code: string, onStart?: () => never): RecordingModule => {
  const started: { roomCode: string; game: GameStartResult }[] = []
  const calls: string[] = []
  const module: GameModule = {
    code,
    start: async (roomCode, game) => {
      started.push({ roomCode, game })
      calls.push('start')
      onStart?.()
    },
    reset: async (roomCode) => {
      calls.push(`reset:${roomCode}`)
    },
    reconnect: async (roomCode) => ({ roomId: roomCode, phase: 'playing', players: [] }),
    pause: async () => {},
    resume: async () => {},
    rehydrate: async () => {},
    removePlayer: async (roomCode, playerId) => {
      calls.push(`removePlayer:${roomCode}:${playerId}`)
    },
    close: async () => {},
    hasState: async () => false,
    handles: () => false,
    handle: async () => {},
  }
  return { module, started, calls }
}

describeRedis('GameLifecycleService', () => {
  const redis = useRedis()

  const wire = (
    module?: GameModule,
  ): { rooms: RoomService; lifecycle: GameLifecycleService; games: GameModuleRegistry } => {
    const rooms = new RoomService(redis())
    const catalog = new GameCatalog()
    const games = new GameModuleRegistry(catalog)
    if (module) games.register(module)
    return { rooms, lifecycle: new GameLifecycleService(rooms, catalog, games), games }
  }

  /** 게임 종료(2.7)의 자리 — RETURN_TO_LOBBY Lua는 FINISHED에서만 통과한다. */
  const finish = async (roomCode: string): Promise<void> => {
    await redis().hset(roomKey(roomCode), 'phase', 'FINISHED')
  }

  const openRoom = async (
    rooms: RoomService,
    gameCode = YACHT_DICE,
    capacity = 6,
  ): Promise<string> => {
    const roomCode = await rooms.createRoom(capacity, HOST.userId, gameCode)
    await rooms.join(roomCode, HOST)
    return roomCode
  }

  /**
   * backend-java `GameLifecycleServiceTest.rollsBackOnlyTheWinningGameWhenModuleInitializationFails`.
   * Java는 모킹으로 `rollbackStart(roomCode, gameId)` 호출만 확인하지만, 여기서는
   * 진짜 Lua가 도는지까지 본다 — 롤백의 계약은 "phase 복구 + 그 game 키 삭제"다.
   */
  it('모듈 초기화가 실패하면 그 게임만 롤백하고 원인 예외를 그대로 올린다', async () => {
    const failure = new Error('initialization_failed')
    const recording = recordingModule(YACHT_DICE, () => {
      throw failure
    })
    const { rooms, lifecycle } = wire(recording.module)
    const roomCode = await openRoom(rooms)

    await expect(lifecycle.start(roomCode)).rejects.toBe(failure)

    const gameId = recording.started[0]?.game.gameId
    expect(recording.started[0]?.roomCode).toBe(roomCode)
    expect(gameId).toBeTruthy()
    const snapshot = await rooms.getSnapshot(roomCode)
    expect(snapshot.phase).toBe('LOBBY')
    expect(snapshot.gameId).toBeNull()
    expect(await redis().exists(gameKey(gameId as string))).toBe(0)
  })

  it('성공하면 모듈에 (roomCode, 시작 결과)를 넘기고 그 결과를 그대로 돌려준다', async () => {
    const recording = recordingModule(YACHT_DICE)
    const { rooms, lifecycle } = wire(recording.module)
    const roomCode = await openRoom(rooms)

    const result = await lifecycle.start(roomCode)

    expect(recording.started).toEqual([{ roomCode, game: result }])
    expect(result.snapshot.phase).toBe('PLAYING')
    expect((await rooms.getSnapshot(roomCode)).gameId).toBe(result.gameId)
  })

  /** 모듈이 아직 없는 게임도 방은 돌아간다 — 시작은 되고 롤백할 것도 없다. */
  it('등록된 모듈이 없어도 phase는 옮긴다', async () => {
    const { rooms, lifecycle } = wire()
    const roomCode = await openRoom(rooms)

    const result = await lifecycle.start(roomCode)

    expect(result.snapshot.phase).toBe('PLAYING')
  })

  /** 시작 인원은 카탈로그 표에서 온다(DUEL=2) — 모듈이 따로 들고 있지 않다. */
  it('minPlayers가 모자라면 START Lua에서 막히고 모듈은 불리지 않는다', async () => {
    const recording = recordingModule(DUEL)
    const { rooms, lifecycle } = wire(recording.module)
    const roomCode = await openRoom(rooms, DUEL, 2)

    await expect(lifecycle.start(roomCode)).rejects.toThrow(new ConflictError('game_not_ready'))
    expect(recording.calls).toEqual([])

    await rooms.join(roomCode, GUEST_2)
    await lifecycle.start(roomCode)
    expect(recording.calls).toEqual(['start'])
  })

  it('모르는 게임 코드는 시작 전에 invalid_game_code로 막는다', async () => {
    const { rooms, lifecycle } = wire()
    const roomCode = await rooms.createRoom(6, HOST.userId, 'CHESS')
    await rooms.join(roomCode, HOST)

    await expect(lifecycle.start(roomCode)).rejects.toThrow(new DomainError('invalid_game_code'))
    expect((await rooms.getSnapshot(roomCode)).phase).toBe('LOBBY')
  })

  it('대기실 복귀는 Lua가 실제로 되돌렸을 때만 모듈을 정리한다', async () => {
    const recording = recordingModule(YACHT_DICE)
    const { rooms, lifecycle } = wire(recording.module)
    const roomCode = await openRoom(rooms)
    await lifecycle.start(roomCode)
    // RETURN_TO_LOBBY는 FINISHED에서만 통과한다(게임 종료는 2.7).
    await finish(roomCode)
    const playing = await rooms.getSnapshot(roomCode)

    expect(await lifecycle.returnToLobby(roomCode, playing)).toBe(true)
    expect(recording.calls).toEqual(['start', `reset:${roomCode}`])
    expect((await rooms.getSnapshot(roomCode)).phase).toBe('LOBBY')

    // 이미 대기실이면 전이가 막히고 모듈도 건드리지 않는다(멱등).
    expect(await lifecycle.returnToLobby(roomCode, playing)).toBe(false)
    expect(recording.calls).toEqual(['start', `reset:${roomCode}`])
  })

  it('게임 중 퇴장은 모듈의 이탈 경로로 넘어간다', async () => {
    const recording = recordingModule(YACHT_DICE)
    const { lifecycle } = wire(recording.module)

    await lifecycle.removePlayer('ROOM01', YACHT_DICE, HOST.userId)

    expect(recording.calls).toEqual([`removePlayer:ROOM01:${HOST.userId}`])
    await expect(lifecycle.removePlayer('ROOM01', 'CHESS', HOST.userId)).rejects.toThrow(
      new DomainError('invalid_game_code'),
    )
  })

  it('모듈이 없는 게임의 퇴장·복귀는 조용히 통과한다', async () => {
    const { rooms, lifecycle } = wire()
    const roomCode = await openRoom(rooms, DUEL, 2)
    await rooms.join(roomCode, GUEST_2)
    await lifecycle.start(roomCode)
    await finish(roomCode)
    const playing = await rooms.getSnapshot(roomCode)

    await lifecycle.removePlayer(roomCode, DUEL, GUEST_2.userId)
    expect(await lifecycle.returnToLobby(roomCode, playing)).toBe(true)
  })
})
