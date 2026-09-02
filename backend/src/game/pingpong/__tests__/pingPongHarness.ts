import { type DeadlineExecutor, InMemoryRoundDeadlineScheduler } from '../../round/index.js'
import { PingPongGameService } from '../pingPongGameService.js'
import type { PingPongStateStore } from '../pingPongPorts.js'
import { initial, ready, swing } from '../pingPongRules.js'
import type { PingPongPlayerNumbers, PingPongState } from '../pingPongState.js'

/**
 * **취소 순서 자체가 계약**이므로(docs/design/games/pingpong.md) 협력자 호출
 * 전체를 한 줄의 로그로 모아 순서까지 고정한다.
 *
 * 시각은 전부 주입된 시계에서 나오고 마감 예약은 테스트가 직접 발화시키므로
 * **실시간 sleep도 가짜 타이머도 없다**(2.3이 executor 시임을 남긴 이유).
 */

export const ROOM = 'room-a'
export const P1 = 'player-1'
export const P2 = 'player-2'

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
export const manualExecutor = (): {
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

export interface Harness {
  readonly calls: string[]
  readonly broadcasts: { readonly type: string; readonly payload: unknown }[]
  readonly states: MemoryPingPongStateStore
  readonly scores: Record<string, number>
  readonly clock: { value: number }
  readonly service: PingPongGameService<TestSnapshot>
}

export const harness = (
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

export const startResult = (hostId: string) => ({
  snapshot: {
    hostId,
    players: [
      { playerId: P1, kind: 'HUMAN' },
      { playerId: P2, kind: 'HUMAN' },
      { playerId: 'bot-1', kind: 'BOT' },
    ],
  },
})

/**
 * 두 사람이 스윙과 준비를 마쳐 카운트다운 직전까지 온 판.
 * 서비스 검사 대부분이 이 상태에서 출발한다.
 */
export function bothReady(): PingPongState {
  return ready(p2NotReadyYet(), P2, 1_400)
}

/** 위와 같되 P2의 준비만 아직이다 — `ready`가 무엇을 일으키는지 보는 검사용. */
export function p2NotReadyYet(): PingPongState {
  let state = initial([P1, P2], 1_000)
  state = swing(state, P1, 0, 1_100, 0.5)
  state = ready(state, P1, 1_200)
  return swing(state, P2, 0, 1_300, 0.5)
}
