import { describe, expect, it } from 'vitest'
import type {
  CompletionOutboundEnvelope,
  CompletionPhase,
  CompletionRoomSnapshot,
  MatchArchivePort,
} from '../completionPorts.js'
import type { GameCompletionStore } from '../completionStore.js'
import { GameCompletionService, type GameFinishedEvent } from '../gameCompletionService.js'
import type { Ranking } from '../gameResultCalculator.js'

const ROOM = 'ROOM1'

describe('GameCompletionService', () => {
  it('전이하지 않았으면 아무 부수효과도 남기지 않는다', async () => {
    const world = createWorld({ transitions: false })

    await expect(world.service.finishIfComplete(ROOM, false)).resolves.toBe(false)

    // game.over 중복 방지의 핵심 — CAS에 진 호출은 방송도, 타이머 취소도, phase 표시도 없다.
    expect(world.broadcasts).toEqual([])
    expect(world.cancelledRooms).toEqual([])
    expect(world.markedPhases).toEqual([])
    expect(world.archived).toEqual([])
  })

  it('게임을 끝냈으면 타이머를 멈추고 순위를 방송한다', async () => {
    const world = createWorld({ transitions: true })

    await expect(world.service.finishIfComplete(ROOM, true)).resolves.toBe(true)

    // 타이머를 멈추지 않으면 종료 직후 만료가 한 번 더 돌아 다음 턴을 시작한다.
    expect(world.cancelledRooms).toEqual([ROOM])
    expect(world.markedPhases).toEqual([[ROOM, 'finished']])
    expect(world.storeCalls).toEqual([{ roomId: ROOM, gameId: 'game-1', force: true }])

    expect(world.broadcasts.map((message) => message.type)).toEqual([
      'game.yacht_dice.game.over',
      // phase(finished)는 스냅샷으로만 전달된다 — 이게 없으면 클라가 결과 화면으로 못 넘어간다.
      'game.yacht_dice.state.sync',
    ])
    expect(world.broadcasts[0]?.payload).toEqual({
      rankings: [
        { rank: 1, playerId: 'player-b', total: 205 },
        { rank: 2, playerId: 'player-a', total: 180 },
        { rank: 2, playerId: 'player-c', total: 180 },
        { rank: 4, playerId: 'player-d', total: 90 },
      ],
    })
    expect(world.broadcasts[1]?.payload).toEqual({ snapshot: { roomId: ROOM, phase: 'finished' } })
    expect(world.broadcasts.every((message) => message.roomId === ROOM)).toBe(true)
  })

  it('완료 메시지 네임스페이스는 방의 게임 코드를 쓴다', async () => {
    const world = createWorld({ transitions: true, gameCode: 'PING_PONG' })

    await expect(world.service.finishIfComplete(ROOM, true)).resolves.toBe(true)

    expect(world.broadcasts.map((message) => message.type)).toEqual([
      'game.ping_pong.game.over',
      'game.ping_pong.state.sync',
    ])
  })

  it('진행 중인 게임이 없으면 저장소를 부르지도 않는다', async () => {
    const world = createWorld({ transitions: true, gameId: null })

    await expect(world.service.finishIfComplete(ROOM, false)).resolves.toBe(false)

    expect(world.storeCalls).toEqual([])
    expect(world.broadcasts).toEqual([])
  })

  it('없는 방이면 false다', async () => {
    const world = createWorld({ transitions: true, room: null })

    await expect(world.service.finishIfComplete(ROOM, false)).resolves.toBe(false)

    expect(world.storeCalls).toEqual([])
  })

  /** 전적 보관 실패가 결과 화면을 막으면 안 된다 — 삼키고 훅으로만 알린다. */
  it('전적 보관이 실패해도 종료는 그대로 진행한다', async () => {
    const failures: unknown[] = []
    const world = createWorld({
      transitions: true,
      archive: {
        archive: () => {
          throw new Error('DB 다운')
        },
      },
      onArchiveFailure: (_roomId, error) => failures.push(error),
    })

    await expect(world.service.finishIfComplete(ROOM, true)).resolves.toBe(true)

    expect(failures).toHaveLength(1)
    expect(world.broadcasts).toHaveLength(2)
  })

  /** 보관 스텁(4.4가 교체)에는 방 스냅샷과 확정된 순위가 그대로 넘어간다. */
  it('전적 보관에 방 스냅샷과 순위를 넘긴다', async () => {
    const world = createWorld({ transitions: true })

    await world.service.finishIfComplete(ROOM, false)

    expect(world.archived).toHaveLength(1)
    expect(world.archived[0]?.room.gameId).toBe('game-1')
    expect(world.archived[0]?.rankings[0]).toEqual({ rank: 1, playerId: 'player-b', total: 205 })
  })

  it('종료 훅에 방·게임·force·순위를 알린다', async () => {
    const finished: unknown[] = []
    const world = createWorld({ transitions: true, onFinished: (event) => finished.push(event) })

    await world.service.finishIfComplete(ROOM, true)

    expect(finished).toEqual([
      expect.objectContaining({ roomId: ROOM, gameId: 'game-1', force: true }),
    ])
  })
})

interface WorldOptions {
  readonly transitions: boolean
  readonly gameCode?: string
  readonly gameId?: string | null
  readonly room?: CompletionRoomSnapshot | null
  readonly archive?: MatchArchivePort
  readonly onArchiveFailure?: (roomId: string, error: unknown) => void
  readonly onFinished?: (event: unknown) => void
}

/** 동점이 1,2,2,4로 접히도록 섞어 둔 총점(Java 테스트의 `totals()`와 같다). */
const totals = (): Map<string, number> =>
  new Map([
    ['player-a', 180],
    ['player-d', 90],
    ['player-b', 205],
    ['player-c', 180],
  ])

const createWorld = (options: WorldOptions) => {
  const broadcasts: CompletionOutboundEnvelope[] = []
  const cancelledRooms: string[] = []
  const markedPhases: [string, CompletionPhase][] = []
  const storeCalls: { roomId: string; gameId: string; force: boolean }[] = []
  const archived: { room: CompletionRoomSnapshot; rankings: readonly Ranking[] }[] = []

  const room: CompletionRoomSnapshot | null =
    options.room === undefined
      ? {
          roomCode: ROOM,
          gameCode: options.gameCode ?? 'YACHT_DICE',
          gameId: options.gameId === undefined ? 'game-1' : options.gameId,
          players: [{ playerId: 'player-a', nickname: 'A', kind: 'HUMAN' }],
        }
      : options.room

  // `exactOptionalPropertyTypes`라 undefined를 넣을 수 없다 — 있는 훅만 담는다.
  const serviceOptions: {
    onArchiveFailure?: (roomId: string, error: unknown) => void
    onFinished?: (event: GameFinishedEvent) => void
  } = {}
  if (options.onArchiveFailure) serviceOptions.onArchiveFailure = options.onArchiveFailure
  if (options.onFinished) serviceOptions.onFinished = options.onFinished

  const completionStore: GameCompletionStore = {
    finishIfComplete: async (roomId, gameId, force) => {
      storeCalls.push({ roomId, gameId, force })
      return options.transitions
    },
    readTotals: async () => totals(),
  }

  const service = new GameCompletionService(
    {
      completionStore,
      deadlineScheduler: {
        cancelRoom: (roomId: string) => {
          cancelledRooms.push(roomId)
        },
      },
      roomService: { getSnapshot: async () => room },
      presence: {
        markPhase: (roomId, phase) => {
          markedPhases.push([roomId, phase])
        },
      },
      realtimeSnapshots: { snapshot: async (roomId) => ({ roomId, phase: 'finished' }) },
      broadcaster: {
        broadcast: (_roomId, message) => {
          broadcasts.push(message)
        },
      },
      matchArchive: options.archive ?? {
        archive: (archivedRoom, rankings) => {
          archived.push({ room: archivedRoom, rankings })
          return true
        },
      },
    },
    serviceOptions,
  )

  return { service, broadcasts, cancelledRooms, markedPhases, storeCalls, archived }
}
