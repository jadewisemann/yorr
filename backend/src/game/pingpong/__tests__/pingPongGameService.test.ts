import { beforeEach, describe, expect, it } from 'vitest'
import { type DeadlineExecutor, InMemoryRoundDeadlineScheduler } from '../../round/index.js'
import { PingPongGameService } from '../pingPongGameService.js'
import type { PingPongStateStore } from '../pingPongPorts.js'
import { initial, POINT_COUNTDOWN_MILLIS, ready, serve, swing } from '../pingPongRules.js'
import type { PingPongPlayerNumbers, PingPongState } from '../pingPongState.js'

/**
 * backend-java `PingPongGameServiceTest`의 이식.
 *
 * Java는 Mockito `verify()`(순서 없음) + 브로드캐스트만 `ArgumentCaptor`로 순서를
 * 봤지만, **취소 순서 자체가 계약**이므로(docs/design/games/pingpong.md) 여기서는
 * 협력자 호출 전체를 한 줄의 로그로 모아 순서까지 고정한다.
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

const harness = (options: { readonly executor?: DeadlineExecutor } = {}): Harness => {
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

  it('연습 스윙 전 ready는 상태를 바꾸지 않으므로 아무 방송도 없다', async () => {
    test.states.state = initial([P1, P2], 1_000)

    await test.service.ready(ROOM, P1)

    expect(test.calls).toEqual([])
    expect((test.states.state as PingPongState).nextActionAt).toBe(0)
  })
})
