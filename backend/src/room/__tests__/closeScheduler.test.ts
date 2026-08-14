import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryRoomCloseScheduler } from '../closeScheduler.js'

describe('InMemoryRoomCloseScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('유예가 지나면 닫기 작업을 실행한다', () => {
    const scheduler = new InMemoryRoomCloseScheduler()
    let closed = 0
    scheduler.schedule('ROOM1', 30_000, () => {
      closed += 1
    })

    vi.advanceTimersByTime(29_999)
    expect(closed).toBe(0)

    vi.advanceTimersByTime(1)
    expect(closed).toBe(1)
  })

  it('취소하면 실행되지 않고, 취소할 예약이 있었는지 알려 준다', () => {
    const scheduler = new InMemoryRoomCloseScheduler()
    let closed = 0
    scheduler.schedule('ROOM1', 30_000, () => {
      closed += 1
    })

    expect(scheduler.cancel('ROOM1')).toBe(true)
    // 두 번째 취소는 취소할 것이 없다 — 호출자는 이 값으로 "복귀"를 판별한다.
    expect(scheduler.cancel('ROOM1')).toBe(false)

    vi.advanceTimersByTime(60_000)
    expect(closed).toBe(0)
  })

  /** 방 하나당 예약은 하나다. 재예약하면 앞의 것은 실행되지 않는다. */
  it('재예약은 이전 예약을 교체한다', () => {
    const scheduler = new InMemoryRoomCloseScheduler()
    const fired: string[] = []
    scheduler.schedule('ROOM1', 30_000, () => {
      fired.push('first')
    })
    scheduler.schedule('ROOM1', 60_000, () => {
      fired.push('second')
    })

    vi.advanceTimersByTime(120_000)

    expect(fired).toEqual(['second'])
  })

  it('닫기 작업이 실패해도 예약기는 살아남는다', async () => {
    const errors: unknown[] = []
    const scheduler = new InMemoryRoomCloseScheduler((error) => errors.push(error))
    scheduler.schedule('ROOM1', 0, async () => {
      throw new Error('redis unavailable')
    })

    await vi.advanceTimersByTimeAsync(1)

    expect(errors).toHaveLength(1)
    expect(() => scheduler.schedule('ROOM2', 0, () => {})).not.toThrow()
  })
})
