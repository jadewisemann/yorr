import { beforeEach, describe, expect, it } from 'vitest'
import { type DeadlineExecutor, InMemoryRoundDeadlineScheduler } from '../../round/index.js'
import { PingPongGameService } from '../pingPongGameService.js'
import type { PingPongStateStore } from '../pingPongPorts.js'
import { initial, POINT_COUNTDOWN_MILLIS, ready, serve, swing } from '../pingPongRules.js'
import type { PingPongPlayerNumbers, PingPongState } from '../pingPongState.js'

/**
 * **취소 순서 자체가 계약**이므로(docs/design/games/pingpong.md) 협력자 호출
 * 전체를 한 줄의 로그로 모아 순서까지 고정한다.
 *
 * 시각은 전부 주입된 시계에서 나오고 마감 예약은 테스트가 직접 발화시키므로
 * **실시간 sleep도 가짜 타이머도 없다**(2.3이 executor 시임을 남긴 이유).
 */

const ROOM = 'room-a'
const P1 = 'player-1'
const P2 = 'player-2'

interface TestSnapshot {
  readonly roomId: string
  readonly phase: string
  readonly hostId: string
  readonly game?: unknown
}

/** 방 하나짜리 인메모리 스토어. version 비증가 변이를 무시하는 계약까지 지킨다. */
class MemoryPingPongStateStore implements PingPongStateStore {
  state: PingPongState | undefined

  async initialize(_roomId: string, state: PingPongState): Promise<void> {
    this.state = state
  }

  async find(_roomId?: string): Promise<PingPongState | undefined> {
    return this.state
  }

  async mutate(
    _roomId: string,
    mutation: (current: PingPongState) => PingPongState | null,
  ): Promise<PingPongState | undefined> {
    if (this.state === undefined) return undefined
    const next = mutation(this.state)
    if (next === null || next.version === this.state.version) return undefined
    this.state = next
    return next
  }

  async remove(_roomId?: string): Promise<boolean> {
    const existed = this.state !== undefined
    this.state = undefined
    return existed
  }
}

/**
 * 마감 작업을 모아 두고 테스트가 직접 발화시키는 executor.
 *
 * 실시간 타이머도 가짜 타이머도 쓰지 않는다. **자동 발화(인라인 executor)는 쓸 수
 * 없다**: 탁구는 서브 → 실점 → 카운트다운 → 서브가 끝없이 이어지는 게임이라
 * 지연을 무시하고 즉시 실행하면 테스트가 무한 루프에 빠진다(실제로 겪었다).
 */
const manualExecutor = (): {
  readonly executor: DeadlineExecutor
  fire(): Promise<void>
  pending(): number
} => {
  const tasks: (() => void)[] = []
  return {
    executor: {
      schedule(task) {
        tasks.push(task)
        return {
          cancel: () => {
            const index = tasks.indexOf(task)
            if (index >= 0) tasks.splice(index, 1)
          },
        }
      },
    },
    /** 가장 오래된 예약을 발화하고, 그 안의 비동기 후속(mutate·방송)까지 흘려보낸다. */
    fire: async () => {
      tasks.shift()?.()
      await new Promise((resolve) => {
        setImmediate(resolve)
      })
    },
    pending: () => tasks.length,
  }
}

interface Harness {
  readonly calls: string[]
  readonly broadcasts: { readonly type: string; readonly payload: unknown }[]
  readonly states: MemoryPingPongStateStore
  readonly scores: Record<string, number>
  readonly clock: { value: number }
  readonly service: PingPongGameService<TestSnapshot>
}

const harness = (
  options: { readonly executor?: DeadlineExecutor; readonly party?: boolean } = {},
): Harness => {
  // 파티 방이면 랠리를 대시보드가 판정한다 — 서버는 예약을 걸지 않는다(frontend ADR-0003).
  const party = options.party === true
  const calls: string[] = []
  const broadcasts: { type: string; payload: unknown }[] = []
  const states = new MemoryPingPongStateStore()
  const scores: Record<string, number> = {}
  const clock = { value: 10_000 }

  const scheduler = new InMemoryRoundDeadlineScheduler({
    ...(options.executor ? { executor: options.executor } : {}),
    now: () => clock.value,
  })

  const service = new PingPongGameService<TestSnapshot>(
    {
      states: {
        initialize: async (roomId, state) => {
          calls.push('states.initialize')
          await states.initialize(roomId, state)
        },
        find: async (roomId) => states.find(roomId),
        mutate: async (roomId, mutation) => states.mutate(roomId, mutation),
        remove: async (roomId) => {
          calls.push('states.remove')
          return states.remove(roomId)
        },
      },
      scheduler: {
        schedule: (roomId, version, deadline, action) => {
          calls.push(`scheduler.schedule(${version})`)
          scheduler.schedule(roomId, version, deadline, action)
        },
        cancelRoom: (roomId) => {
          calls.push('scheduler.cancelRoom')
          scheduler.cancelRoom(roomId)
        },
      },
      broadcaster: {
        broadcast: (_roomId, message) => {
          calls.push(`broadcast(${message.type})`)
          broadcasts.push({ type: message.type, payload: message.payload })
        },
      },
      snapshots: {
        snapshot: async () => ({ roomId: ROOM, phase: 'waiting', hostId: P2 }),
      },
      presence: {
        markPhase: (_roomId, phase) => {
          calls.push(`presence.markPhase(${phase})`)
        },
        removePlayer: (_roomId, playerId) => {
          calls.push('presence.removePlayer')
          return { playerId }
        },
      },
      completion: {
        finishIfComplete: (_roomId, force) => {
          calls.push(`completion.finishIfComplete(${force})`)
          return true
        },
      },
      scoreWriter: {
        record: async (_roomId, recorded: PingPongPlayerNumbers) => {
          calls.push('scoreWriter.record')
          Object.assign(scores, recorded)
        },
      },
      rooms: {
        leave: async () => {
          calls.push('rooms.leave')
          return true
        },
        cancelActiveGame: async () => {
          calls.push('rooms.cancelActiveGame')
          return true
        },
        isPartyRoom: async () => party,
      },
    },
    { now: () => clock.value, randomTarget: () => 0.5 },
  )

  return { calls, broadcasts, states, scores, clock, service }
}

const startResult = (hostId: string) => ({
  snapshot: {
    hostId,
    players: [
      { playerId: P1, kind: 'HUMAN' },
      { playerId: P2, kind: 'HUMAN' },
      { playerId: 'bot-1', kind: 'BOT' },
    ],
  },
})

describe('PingPongGameService', () => {
  let test: Harness

  beforeEach(() => {
    test = harness()
  })

  it('PREPARING 중 이탈은 플레이어를 빼고 방을 다시 열어 준다', async () => {
    test.states.state = initial([P1, P2], 1_000)

    await test.service.removePlayer(ROOM, P1)

    // 순서가 계약이다: 좌석·방에서 빼고 알린 **뒤에** 매치를 취소한다.
    expect(test.calls).toEqual([
      'presence.removePlayer',
      'rooms.leave',
      'broadcast(room.player_left)',
      'scheduler.cancelRoom',
      'states.remove',
      'rooms.cancelActiveGame',
      'presence.markPhase(waiting)',
      'broadcast(game.ping_pong.state.sync)',
    ])
    // 방송은 정확히 2건. `room.player_left`는 **게임 네임스페이스가 붙지 않는다**.
    expect(test.broadcasts.map((message) => message.type)).toEqual([
      'room.player_left',
      'game.ping_pong.state.sync',
    ])
    // 시작도 안 한 매치를 이겼다고 주지 않는다 — 점수 기록도 종료 판정도 없다.
    expect(test.calls).not.toContain('scoreWriter.record')
    expect(test.states.state).toBeUndefined()
  })

  it('시작하면 phase를 playing으로 옮기고 방장을 첫 리시버로 세운다', async () => {
    await test.service.start(ROOM, startResult(P2))

    expect(test.calls).toEqual([
      'states.initialize',
      'presence.markPhase(playing)',
      'broadcast(game.ping_pong.state)',
      'broadcast(game.ping_pong.state.sync)',
    ])
    const state = test.states.state as PingPongState
    // 봇은 걸러지고(탁구는 봇 없음) 방장이 playerOrder[0]이다.
    expect(state.playerOrder).toEqual([P2, P1])
    expect(state.serveReceiverId).toBe(P2)
    expect(state.phase).toBe('PREPARING')
    // PREPARING은 nextActionAt=0이라 예약이 걸리지 않는다.
    expect(test.calls).not.toContain('scheduler.schedule(1)')
  })

  it('경기 중 이탈은 몰수 → 점수 기록 → 종료 판정 순으로 이어진다', async () => {
    let state = initial([P1, P2], 1_000)
    state = swing(state, P1, 0, 1_100, 0.5)
    state = ready(state, P1, 1_200)
    state = swing(state, P2, 0, 1_300, 0.5)
    state = ready(state, P2, 1_400)
    test.states.state = serve(state, 4_000, 0.7)

    await test.service.removePlayer(ROOM, P1)

    expect(test.calls).toEqual([
      'presence.removePlayer',
      'rooms.leave',
      'broadcast(room.player_left)',
      'scheduler.cancelRoom',
      'scoreWriter.record',
      'completion.finishIfComplete(true)',
      'broadcast(game.ping_pong.state)',
      'broadcast(game.ping_pong.state.sync)',
    ])
    expect((test.states.state as PingPongState).phase).toBe('FINISHED')
    // 종료 판정보다 점수 기록이 먼저다 — `game.over` 순위가 최종 점수를 봐야 한다.
    expect(test.scores).toEqual({ [P1]: 0, [P2]: 11 })
  })

  it('카운트다운 마감이 서브로 이어지고 다음 실점 마감을 예약한다', async () => {
    const timers = manualExecutor()
    const test2 = harness({ executor: timers.executor })
    let state = initial([P1, P2], 1_000)
    state = swing(state, P1, 0, 1_100, 0.5)
    state = ready(state, P1, 1_200)
    state = swing(state, P2, 0, 1_300, 0.5)
    test2.states.state = state
    test2.clock.value = 1_400

    // 전원 ready → COUNTDOWN(version 5) 예약. 예약 키는 라운드가 아니라 version이다.
    await test2.service.ready(ROOM, P2)
    expect(test2.calls).toEqual([
      'broadcast(game.ping_pong.state)',
      'broadcast(game.ping_pong.state.sync)',
      'scheduler.schedule(5)',
    ])

    test2.clock.value = 1_400 + POINT_COUNTDOWN_MILLIS
    await timers.fire()

    const served = test2.states.state as PingPongState
    expect(served.phase).toBe('PLAYING')
    expect(served.lastEvent?.type).toBe('SERVE')
    // 서브는 리시버(P1)의 반대쪽 끝에서 출발한다.
    expect(served.ball.direction).toBe(1)
    expect(served.ball.pos).toBe(0)
    // 서브 방송에는 방 스냅샷이 붙지 않고, 다음 실점 마감이 새 version으로 예약된다.
    expect(test2.calls.slice(3)).toEqual([
      'broadcast(game.ping_pong.state)',
      'scheduler.schedule(6)',
    ])
    expect(timers.pending()).toBe(1)
    expect(test2.broadcasts.filter((m) => m.type.endsWith('state.sync'))).toHaveLength(1)
  })

  it('예약 시점과 version이 어긋난 마감은 아무것도 하지 않는다', async () => {
    const timers = manualExecutor()
    const test2 = harness({ executor: timers.executor })
    let state = initial([P1, P2], 1_000)
    state = swing(state, P1, 0, 1_100, 0.5)
    state = ready(state, P1, 1_200)
    state = swing(state, P2, 0, 1_300, 0.5)
    test2.states.state = state
    test2.clock.value = 1_400

    await test2.service.ready(ROOM, P2) // version 5 예약
    const scheduled = test2.calls.length
    // 그 사이 연습 스윙이 하나 더 들어와 version이 6이 됐다면 그 예약은 스테일이다.
    test2.states.state = swing(test2.states.state as PingPongState, P1, 1, 1_450, 0.5)

    test2.clock.value = 1_400 + POINT_COUNTDOWN_MILLIS
    await timers.fire()

    expect(test2.calls).toHaveLength(scheduled)
    expect((test2.states.state as PingPongState).phase).toBe('COUNTDOWN')
  })

  it('스윙은 클라이언트 시각으로 판정하되 120ms까지만 되감는다', async () => {
    let state = initial([P1, P2], 1_000)
    state = swing(state, P1, 0, 1_100, 0.5)
    state = ready(state, P1, 1_200)
    state = swing(state, P2, 0, 1_300, 0.5)
    state = ready(state, P2, 1_400)
    test.states.state = serve(state, 4_000, 0.7)

    // 서버 시각은 이상점을 200ms 지났지만(5_100) 클라가 찍은 4_900을 되감아 판정한다.
    test.clock.value = 5_000
    await test.service.swing(ROOM, P1, { inputSeq: 1, clientTs: 4_900 })

    expect((test.states.state as PingPongState).lastEvent?.type).toBe('SMASH')
  })

  it('음수 inputSeq는 도메인 오류다', async () => {
    test.states.state = initial([P1, P2], 1_000)

    await expect(test.service.swing(ROOM, P1, { inputSeq: -1, clientTs: 1_000 })).rejects.toThrow(
      'invalid_ping_pong_swing',
    )
    await expect(test.service.swing(ROOM, P1, null)).rejects.toThrow('invalid_ping_pong_swing')
  })

  it('2인이 아니면 시작하지 않는다', async () => {
    await expect(
      test.service.start(ROOM, {
        snapshot: { hostId: P1, players: [{ playerId: P1, kind: 'HUMAN' }] },
      }),
    ).rejects.toThrow('ping_pong_requires_two_players')
  })

  it('reset은 상태를 버리고 대기실 스냅샷만 다시 쏜다', async () => {
    test.states.state = initial([P1, P2], 1_000)

    await test.service.reset(ROOM)

    expect(test.calls).toEqual([
      'scheduler.cancelRoom',
      'states.remove',
      'presence.markPhase(waiting)',
      'broadcast(game.ping_pong.state.sync)',
    ])
    // 로비 복귀는 이미 끝난 게임이라 gameId를 되돌릴 것이 없다(취소 경로와 다르다).
    expect(test.calls).not.toContain('rooms.cancelActiveGame')
  })

  it('재접속 스냅샷은 진행 중 상태를 game 필드에 싣는다', async () => {
    const state = initial([P1, P2], 1_000)
    test.states.state = state

    expect(await test.service.reconnect(ROOM)).toEqual({
      roomId: ROOM,
      phase: 'waiting',
      hostId: P2,
      game: state,
    })

    await test.states.remove()
    expect(await test.service.reconnect(ROOM)).toEqual({
      roomId: ROOM,
      phase: 'waiting',
      hostId: P2,
    })
  })

  /**
   * 부팅 재무장(deploy/PLAN.md PR 6). 탁구도 결투와 같아서 마감(`nextActionAt`)이 상태
   * 안의 절대 시각이고 상태가 Redis에 있으므로 되살릴 것은 예약뿐이다. **여기서 마감을
   * 새로 계산하면 안 된다** — 공의 다음 사건 시각이 곧 마감이라 새 값을 주면 랠리가
   * 어긋난다.
   *
   * `resume`과 다른 점은 이어갈 수 없을 때 던진다는 것뿐이다. 조용히 넘어가면 상태만
   * 살아 있고 공이 얼어붙은 방이 남는다.
   */
  it('rehydrate는 진행 중 상태의 마감을 되살린다', async () => {
    const timers = manualExecutor()
    const test2 = harness({ executor: timers.executor })
    let state = initial([P1, P2], 1_000)
    state = swing(state, P1, 0, 1_100, 0.5)
    state = ready(state, P1, 1_200)
    state = swing(state, P2, 0, 1_300, 0.5)
    state = ready(state, P2, 1_400)
    test2.states.state = state
    expect(state.nextActionAt).toBeGreaterThan(0)
    test2.calls.length = 0

    await test2.service.rehydrate(ROOM)

    expect(test2.calls).toContain(`scheduler.schedule(${state.version})`)
    expect(timers.pending()).toBe(1)
  })

  it('rehydrate는 상태가 없으면 던진다', async () => {
    await expect(test.service.rehydrate(ROOM)).rejects.toThrow('탁구 상태가 없습니다')
  })

  it('rehydrate는 이미 끝난 판에서 던진다', async () => {
    let state = initial([P1, P2], 1_000)
    state = swing(state, P1, 0, 1_100, 0.5)
    state = ready(state, P1, 1_200)
    state = swing(state, P2, 0, 1_300, 0.5)
    state = ready(state, P2, 1_400)
    test.states.state = serve(state, 4_000, 0.7)
    // 경기 중 이탈 = 몰수 → FINISHED.
    await test.service.removePlayer(ROOM, P1)
    expect((test.states.state as PingPongState).phase).toBe('FINISHED')

    await expect(test.service.rehydrate(ROOM)).rejects.toThrow('이미 끝난 방입니다')
  })

  it('연습 스윙 전 ready는 상태를 바꾸지 않으므로 아무 방송도 없다', async () => {
    test.states.state = initial([P1, P2], 1_000)

    await test.service.ready(ROOM, P1)

    expect(test.calls).toEqual([])
    expect((test.states.state as PingPongState).nextActionAt).toBe(0)
  })
})

/**
 * 파티 모드 호스트 판정 — frontend ADR-0003.
 *
 * 여기서 고정하는 것은 **서버가 무엇을 놓았고 무엇을 놓지 않았는가**다:
 * 랠리 시뮬레이션은 놓고(예약 없음·스윙 미판정), 검증·방송·종료 확정은 그대로 쥔다.
 */
describe('PingPongGameService (파티 모드 호스트 판정)', () => {
  const DASHBOARD = 'dashboard-1'
  let test: Harness

  beforeEach(() => {
    test = harness({ party: true })
  })

  const playing = (over: Partial<PingPongState> = {}): PingPongState => ({
    ...initial([P1, P2], 1_000),
    phase: 'PLAYING',
    nextActionAt: 9_000,
    ...over,
  })

  it('파티 방에서 게임을 시작하면 마감 예약을 걸지 않는다', async () => {
    // 걸어 두면 서버가 자기 시뮬레이션으로 점수를 내고 game.over까지 만든다.
    await test.service.start(ROOM, startResult(P1))

    expect(test.calls.filter((call) => call.startsWith('scheduler.schedule'))).toEqual([])
  })

  it('스윙을 판정하지 않고 대시보드에게 넘긴다', async () => {
    test.states.state = playing()
    const before = test.states.state.version
    test.broadcasts.length = 0

    await test.service.swing(ROOM, P1, { inputSeq: 1, clientTs: 1_000 })

    expect(test.broadcasts.map((message) => message.type)).toEqual(['game.ping_pong.swung'])
    expect(test.broadcasts[0]?.payload).toMatchObject({ playerId: P1, inputSeq: 1 })
    // 상태는 그대로여야 한다 — 판정은 대시보드 몫이다.
    expect(test.states.state?.version).toBe(before)
  })

  it('대시보드가 보고한 상태를 그대로 받아 방송한다', async () => {
    test.states.state = playing()
    test.broadcasts.length = 0

    await test.service.hostState(ROOM, DASHBOARD, playing({ version: 99, rally: 7 }))

    expect(test.states.state?.rally).toBe(7)
    expect(test.broadcasts.map((message) => message.type)).toEqual(['game.ping_pong.state'])
  })

  it('플레이어가 보낸 보고는 무시한다', async () => {
    test.states.state = playing()

    await test.service.hostState(ROOM, P1, playing({ version: 99, scores: { [P1]: 11, [P2]: 0 } }))

    // 자기 점수를 올리는 통로가 되면 안 된다.
    expect(test.states.state?.scores[P1]).toBe(0)
  })

  it('version이 되돌아가는 보고는 무시한다', async () => {
    test.states.state = playing({ version: 50 })

    await test.service.hostState(ROOM, DASHBOARD, playing({ version: 49, rally: 3 }))

    expect(test.states.state?.rally).toBe(0)
  })

  it('roster를 바꾸는 보고는 무시한다', async () => {
    test.states.state = playing()

    await test.service.hostState(
      ROOM,
      DASHBOARD,
      playing({ version: 99, playerOrder: [P1, 'stranger'] }),
    )

    expect(test.states.state?.version).toBe(playing().version)
  })

  it('FINISHED 보고는 서버가 점수를 쓰고 완료 경로를 탄다', async () => {
    test.states.state = playing()
    test.calls.length = 0

    await test.service.hostState(
      ROOM,
      DASHBOARD,
      playing({ version: 99, phase: 'FINISHED', scores: { [P1]: 11, [P2]: 8 } }),
    )

    // 점수를 종료 판정보다 먼저 써야 game.over의 순위가 최종 점수를 본다.
    expect(test.calls.filter((call) => !call.startsWith('broadcast'))).toEqual([
      'scheduler.cancelRoom',
      'scoreWriter.record',
      'completion.finishIfComplete(true)',
    ])
    expect(test.scores).toEqual({ [P1]: 11, [P2]: 8 })
  })

  it('파티 방이 아니면 보고를 받지 않는다', async () => {
    const normal = harness()
    normal.states.state = { ...initial([P1, P2], 1_000), phase: 'PLAYING' }

    await normal.service.hostState(ROOM, DASHBOARD, playing({ version: 99, rally: 7 }))

    expect(normal.states.state?.rally).toBe(0)
  })
})
