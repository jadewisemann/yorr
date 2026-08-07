import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatCountdown, useCountdown } from '@/yacht/useCountdown'

describe('formatCountdown', () => {
  it('formats as minutes and zero-padded seconds', () => {
    expect(formatCountdown(18_000)).toBe('0:18')
    expect(formatCountdown(65_000)).toBe('1:05')
  })

  it('rounds partial seconds up so the timer never shows 0 while time remains', () => {
    expect(formatCountdown(1)).toBe('0:01')
    expect(formatCountdown(0)).toBe('0:00')
  })

  it('never renders a negative clock', () => {
    expect(formatCountdown(-5_000)).toBe('0:00')
  })
})

describe('useCountdown', () => {
  // 남은 시간은 Date.now()로 계산한다. 타이머와 시계를 함께 움직여야 값이 바뀐다.
  let now = 0

  beforeEach(() => {
    now = 1_700_000_000_000
    vi.useFakeTimers()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const advance = (ms: number) =>
    act(() => {
      now += ms
      vi.advanceTimersByTime(ms)
    })

  it('counts down from an absolute deadline', () => {
    const deadline = now + 10_000
    const { result } = renderHook(() => useCountdown(deadline))

    expect(result.current).toBe(10_000)
    advance(3_000)
    expect(result.current).toBe(7_000)
  })

  it('stops at zero instead of going negative', () => {
    const deadline = now + 1_000
    const { result } = renderHook(() => useCountdown(deadline))

    advance(5_000)
    expect(result.current).toBe(0)
  })

  it('reports no time left when there is no deadline yet', () => {
    const { result } = renderHook(() => useCountdown(null))
    expect(result.current).toBe(0)
  })

  it('restarts when the server moves the deadline to the next round', () => {
    const start = now
    const { rerender, result } = renderHook(({ deadline }) => useCountdown(deadline), {
      initialProps: { deadline: start + 5_000 },
    })

    advance(4_000)
    expect(result.current).toBe(1_000)

    rerender({ deadline: now + 30_000 })
    expect(result.current).toBe(30_000)
  })

  it('stops ticking once unmounted', () => {
    const deadline = now + 10_000
    const { result, unmount } = renderHook(() => useCountdown(deadline))
    unmount()

    advance(3_000)
    expect(result.current).toBe(10_000)
  })
})
