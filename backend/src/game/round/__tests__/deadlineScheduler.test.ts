import { describe, expect, it } from 'vitest'
import {
  type DeadlineExecutor,
  InMemoryRoundDeadlineScheduler,
  type ScheduledTimeout,
} from '../deadlineScheduler.js'

/**
 * backend-java `InMemoryRoundDeadlineSchedulerTest`의 이식. Mockito
 * `mock(ScheduledExecutorService)` 자리에 손으로 만든 executor 시임을 넣는다 —
 * 실시간 sleep도, 가짜 타이머 advance도 쓰지 않는다.
 */
describe('InMemoryRoundDeadlineScheduler', () => {
  /**
   * 마감이 이미 지났으면 delay가 0이라 워커가 schedule()의 맵 갱신보다 먼저 깨어날 수 있다.
   * 슬롯을 나중에 잡으면 그 실행이 "내 차례가 아니다"로 조용히 버려지고, 그 방은 다음
   * schedule까지 타임아웃이 영영 안 온다 — 탁구에서 서브가 안 나가고 공이 얼어붙던 원인.
   * 즉시 실행 executor가 그 최악의 순서를 그대로 재현한다.
   */
  it('워커가 슬롯 등록보다 먼저 발화해도 타임아웃을 실행한다', () => {
    let fired = 0
    const scheduler = new InMemoryRoundDeadlineScheduler({ executor: inlineExecutor() })

    scheduler.schedule('room', 1, Date.now() - 1, () => {
      fired += 1
    })

    expect(fired).toBe(1)
  })

  /** 같은 방을 다시 예약하면 앞의 예약은 무효다 — 세대가 바뀌었으므로 옛 실행은 무시된다. */
  it('같은 방의 이전 예약을 무효화한다', () => {
    let stale = 0
    let fresh = 0
    const deferred = deferredExecutor()
    const scheduler = new InMemoryRoundDeadlineScheduler({ executor: deferred.executor })

    scheduler.schedule('room', 1, Date.now() + 10_000, () => {
      stale += 1
    })
    const staleTask = deferred.pending()
    scheduler.schedule('room', 2, Date.now() + 10_000, () => {
      fresh += 1
    })

    staleTask()
    deferred.pending()()

    expect(stale).toBe(0)
    expect(fresh).toBe(1)
  })

  /** 예약한 작업을 실행 전에 취소하면 아무것도 실행되지 않는다. */
  it('cancelRoom은 대기 중인 타임아웃을 버린다', () => {
    let fired = 0
    const deferred = deferredExecutor()
    const scheduler = new InMemoryRoundDeadlineScheduler({ executor: deferred.executor })

    scheduler.schedule('room', 1, Date.now() + 10_000, () => {
      fired += 1
    })
    scheduler.cancelRoom('room')
    deferred.pending()()

    expect(fired).toBe(0)
    expect(deferred.cancelled).toBe(1)
  })

  it('cancel은 라운드 번호가 일치할 때만 취소한다', () => {
    let fired = 0
    const deferred = deferredExecutor()
    const scheduler = new InMemoryRoundDeadlineScheduler({ executor: deferred.executor })

    scheduler.schedule('room', 3, Date.now() + 10_000, () => {
      fired += 1
    })
    // 이미 지나간 라운드의 취소는 지금 예약을 건드리지 않는다.
    scheduler.cancel('room', 2)
    deferred.pending()()
    expect(fired).toBe(1)

    scheduler.schedule('room', 4, Date.now() + 10_000, () => {
      fired += 1
    })
    scheduler.cancel('room', 4)
    deferred.pending()()
    expect(fired).toBe(1)
  })

  it('마감 작업이 실패해도 예약기는 살아남는다', async () => {
    const errors: unknown[] = []
    const scheduler = new InMemoryRoundDeadlineScheduler({
      executor: inlineExecutor(),
      onError: (error) => errors.push(error),
    })

    scheduler.schedule('room', 1, Date.now(), async () => {
      throw new Error('redis unavailable')
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(errors).toHaveLength(1)
    expect(() => scheduler.schedule('room2', 1, Date.now(), () => {})).not.toThrow()
  })

  it('roomId·roundNumber를 검증한다', () => {
    const scheduler = new InMemoryRoundDeadlineScheduler({ executor: deferredExecutor().executor })

    expect(() => scheduler.schedule(' ', 1, Date.now(), () => {})).toThrow(
      'roomId must not be blank',
    )
    expect(() => scheduler.schedule('room', 0, Date.now(), () => {})).toThrow(
      'roundNumber must be at least 1',
    )
  })
})

/** schedule()이 반환하기 전에 작업을 실행해 버리는 executor — 최악의 순서 재현용. */
const inlineExecutor = (): DeadlineExecutor => ({
  schedule(task) {
    task()
    return noopTimeout()
  },
})

/** 작업을 붙잡아 두고 테스트가 원하는 시점에 실행시키는 executor. */
const deferredExecutor = (): {
  executor: DeadlineExecutor
  pending: () => () => void
  cancelled: number
} => {
  const tasks: Array<() => void> = []
  const state = {
    executor: {
      schedule(task: () => void): ScheduledTimeout {
        tasks.push(task)
        return {
          cancel: () => {
            state.cancelled += 1
          },
        }
      },
    },
    pending: (): (() => void) => {
      const task = tasks.at(-1)
      if (task === undefined) throw new Error('no pending task')
      return task
    },
    cancelled: 0,
  }
  return state
}

const noopTimeout = (): ScheduledTimeout => ({ cancel: () => {} })
