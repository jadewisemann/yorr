import type { VersionedState } from '../versionedStateStore.js'

/**
 * 버전 상태 저장소의 인메모리 대역. 다빈치·결투가 같은 것을 두 벌 갖고 있었다.
 *
 * 진짜와 같은 판정을 쓴다: 없는 방은 `null`, **version이 오르지 않은 변이는 버린다.**
 * 그 규칙이 다르면 검사가 통과해도 운영에서 갈라진다.
 */
export class InMemoryVersionedStateStore<S extends VersionedState> {
  private readonly states = new Map<string, S>()

  constructor(private readonly alreadyInitializedCode: string) {}

  async initialize(roomId: string, state: S): Promise<void> {
    if (this.states.has(roomId)) throw new Error(this.alreadyInitializedCode)
    this.states.set(roomId, state)
  }

  async find(roomId: string): Promise<S | null> {
    return this.states.get(roomId) ?? null
  }

  async mutate(roomId: string, mutation: (current: S) => S | null): Promise<S | null> {
    const current = this.states.get(roomId)
    if (current === undefined) return null
    const next = mutation(current)
    if (next === null || next.version <= current.version) return null
    this.states.set(roomId, next)
    return next
  }

  async remove(roomId: string): Promise<boolean> {
    return this.states.delete(roomId)
  }
}

export interface ScheduledDeadline {
  readonly version: number
  readonly deadline: number
  readonly action: () => void | Promise<void>
}

/**
 * 마감 예약기의 대역. 실제로 기다리지 않고 **예약 목록만 쌓아 두었다가** 검사가
 * `fireLatest()`로 직접 발화시킨다 — 그래야 시간에 기대지 않는 검사가 된다.
 */
export class FakeDeadlineScheduler {
  readonly scheduled: ScheduledDeadline[] = []
  cancelled = 0

  schedule(
    _roomId: string,
    version: number,
    deadline: Date | number,
    timeoutAction: () => void | Promise<void>,
  ): void {
    this.scheduled.push({
      version,
      deadline: deadline instanceof Date ? deadline.getTime() : deadline,
      action: timeoutAction,
    })
  }

  cancelRoom(): unknown {
    this.cancelled += 1
    return undefined
  }

  async fireLatest(): Promise<void> {
    const latest = this.scheduled.at(-1)
    if (latest === undefined) throw new Error('예약된 마감이 없다')
    await latest.action()
  }
}
