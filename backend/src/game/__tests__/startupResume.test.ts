import { describe, expect, it } from 'vitest'
import {
  resumeGamesOnStartup,
  type StartupResumeModules,
  type StartupResumeRooms,
} from '../startupResume.js'

/**
 * 부팅 재무장의 정책(deploy/PLAN.md PR 6).
 *
 * 이 스위트가 고정하는 것은 **fail-closed**다. 예전 정책(`closeUnrecoverableGamesOnStartup`)은
 * 진행 중이던 방을 전부 닫았고, 그것이 "배포가 게임을 끊는다"의 전부였다. 되살리기가
 * 가능해진 지금 새 실패 모드가 하나 생긴다: **되살리지 못한 방을 열어 둔 채 넘어가는
 * 것.** 그 방은 상태만 살아 있고 턴이 넘어가지 않으며 JOIN도 `game_started`로 막혀,
 * TTL이 끝날 때까지 아무도 들어갈 수 없다. 예전 정책보다 나쁘다.
 *
 * 그래서 여기서 보는 것은 "몇 개를 되살렸나"가 아니라 **"되살리지 못한 방이 반드시
 * 닫히는가"** 다.
 */

interface Harness {
  readonly rooms: StartupResumeRooms
  readonly games: StartupResumeModules
  readonly closed: string[]
  readonly rehydrated: string[]
}

const harness = (
  layout: Record<string, { phase: string | null; gameCode: string | null }>,
  behavior: { failing?: readonly string[]; unknownCodes?: readonly string[] } = {},
): Harness => {
  const closed: string[] = []
  const rehydrated: string[] = []
  const failing = new Set(behavior.failing ?? [])
  const unknown = new Set(behavior.unknownCodes ?? [])

  const rooms: StartupResumeRooms = {
    getAllRoomCodes: async () => Object.keys(layout),
    getSnapshot: async (roomCode) => layout[roomCode] ?? { phase: null, gameCode: null },
    close: async (roomCode) => {
      closed.push(roomCode)
    },
  }
  const games: StartupResumeModules = {
    byCode: (code) =>
      code === null || code === undefined || unknown.has(code)
        ? undefined
        : {
            rehydrate: async (roomCode: string) => {
              rehydrated.push(roomCode)
              if (failing.has(roomCode)) throw new Error(`이어갈 수 없다: ${roomCode}`)
            },
          },
  }
  return { rooms, games, closed, rehydrated }
}

describe('resumeGamesOnStartup', () => {
  it('진행 중인 방을 모듈에 넘겨 되살린다', async () => {
    const { rooms, games, rehydrated, closed } = harness({
      ROOM1: { phase: 'PLAYING', gameCode: 'YACHT_DICE' },
      ROOM2: { phase: 'PLAYING', gameCode: 'DUEL' },
    })

    await expect(resumeGamesOnStartup({ rooms, games })).resolves.toEqual({
      resumed: 2,
      closed: 0,
    })
    expect(rehydrated).toEqual(['ROOM1', 'ROOM2'])
    expect(closed).toEqual([])
  })

  /**
   * LOBBY·FINISHED를 건드리지 않는 것이 계약이다. 예전 구현이 부팅마다 `room:*`를
   * 전부 지워 살아 있는 대기실까지 전멸시켰던 회귀의 재발 방지다.
   */
  it('대기실·종료된 방·사라진 방은 건드리지 않는다', async () => {
    const { rooms, games, rehydrated, closed } = harness({
      ROOM1: { phase: 'LOBBY', gameCode: 'YACHT_DICE' },
      ROOM2: { phase: 'FINISHED', gameCode: 'YACHT_DICE' },
      ROOM3: { phase: null, gameCode: null },
    })

    await expect(resumeGamesOnStartup({ rooms, games })).resolves.toEqual({
      resumed: 0,
      closed: 0,
    })
    expect(rehydrated).toEqual([])
    expect(closed).toEqual([])
  })

  it('이어갈 수 없는 방은 닫는다', async () => {
    const { rooms, games, closed } = harness(
      { ROOM1: { phase: 'PLAYING', gameCode: 'YACHT_DICE' } },
      { failing: ['ROOM1'] },
    )

    await expect(resumeGamesOnStartup({ rooms, games })).resolves.toEqual({
      resumed: 0,
      closed: 1,
    })
    expect(closed).toEqual(['ROOM1'])
  })

  /** 한 방의 실패가 나머지 방의 복구를 막으면 예전 정책보다 나빠진다. */
  it('한 방이 실패해도 나머지는 되살린다', async () => {
    const { rooms, games, rehydrated, closed } = harness(
      {
        ROOM1: { phase: 'PLAYING', gameCode: 'YACHT_DICE' },
        ROOM2: { phase: 'PLAYING', gameCode: 'YACHT_DICE' },
        ROOM3: { phase: 'PLAYING', gameCode: 'YACHT_DICE' },
      },
      { failing: ['ROOM2'] },
    )

    await expect(resumeGamesOnStartup({ rooms, games })).resolves.toEqual({
      resumed: 2,
      closed: 1,
    })
    expect(rehydrated).toEqual(['ROOM1', 'ROOM2', 'ROOM3'])
    expect(closed).toEqual(['ROOM2'])
  })

  /** 되살릴 주체가 없으면 예전 정책(닫는다)이 그대로 옳다. */
  it('모듈이 없는 게임 코드의 방은 닫는다', async () => {
    const { rooms, games, rehydrated, closed } = harness(
      { ROOM1: { phase: 'PLAYING', gameCode: 'SOME_UNPORTED_GAME' } },
      { unknownCodes: ['SOME_UNPORTED_GAME'] },
    )

    await expect(resumeGamesOnStartup({ rooms, games })).resolves.toEqual({
      resumed: 0,
      closed: 1,
    })
    expect(rehydrated).toEqual([])
    expect(closed).toEqual(['ROOM1'])
  })

  /**
   * 닫기까지 실패해도 순회가 멈추면 안 된다. 여기서 던지면 뒤에 남은 방들이 아예
   * 복구되지 않고 기동만 실패하는데, 그것은 이 함수가 막으려는 상태보다 나쁘다.
   */
  it('닫기가 실패해도 뒤의 방을 계속 복구한다', async () => {
    const rehydrated: string[] = []
    const rooms: StartupResumeRooms = {
      getAllRoomCodes: async () => ['ROOM1', 'ROOM2'],
      getSnapshot: async () => ({ phase: 'PLAYING', gameCode: 'YACHT_DICE' }),
      close: async () => {
        throw new Error('redis down')
      },
    }
    const games: StartupResumeModules = {
      byCode: () => ({
        rehydrate: async (roomCode: string) => {
          rehydrated.push(roomCode)
          if (roomCode === 'ROOM1') throw new Error('이어갈 수 없다')
        },
      }),
    }

    await expect(resumeGamesOnStartup({ rooms, games })).resolves.toEqual({
      resumed: 1,
      closed: 1,
    })
    expect(rehydrated).toEqual(['ROOM1', 'ROOM2'])
  })

  it('되살린 방과 닫은 방을 각각 알린다', async () => {
    const resumedLog: { roomCode: string; gameCode: string }[] = []
    const closedLog: { roomCode: string; reason: unknown }[] = []
    const { rooms, games } = harness(
      {
        ROOM1: { phase: 'PLAYING', gameCode: 'YACHT_DICE' },
        ROOM2: { phase: 'PLAYING', gameCode: 'PING_PONG' },
      },
      { failing: ['ROOM2'] },
    )

    await resumeGamesOnStartup(
      { rooms, games },
      {
        onResumed: (roomCode, gameCode) => resumedLog.push({ roomCode, gameCode }),
        onClosed: (roomCode, reason) => closedLog.push({ roomCode, reason }),
      },
    )

    expect(resumedLog).toEqual([{ roomCode: 'ROOM1', gameCode: 'YACHT_DICE' }])
    expect(closedLog).toHaveLength(1)
    const closure = closedLog[0]
    expect(closure?.roomCode).toBe('ROOM2')
    expect(closure?.reason instanceof Error ? closure.reason.message : '').toContain(
      '이어갈 수 없다',
    )
  })
})
