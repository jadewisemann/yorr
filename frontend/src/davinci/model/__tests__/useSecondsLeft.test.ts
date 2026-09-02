import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSecondsLeft } from '@/davinci/model/useSecondsLeft'

const NOW = 1_700_000_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())

describe('useSecondsLeft', () => {
  it('마감이 없으면 0에 머물고 시계를 돌리지 않는다', () => {
    const { result } = renderHook(() => useSecondsLeft(0))

    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('시간이 흐르면 남은 초가 줄고, 마감을 넘기면 0에서 멈춘다', () => {
    const { result } = renderHook(() => useSecondsLeft(NOW + 3_000))

    expect(result.current).toBe(3)

    act(() => void vi.advanceTimersByTime(1_100))
    expect(result.current).toBe(2)

    act(() => void vi.advanceTimersByTime(5_000))
    expect(result.current).toBe(0)
  })

  it('마감이 새로 잡히면 그 자리에서 다시 센다', () => {
    const { rerender, result } = renderHook(({ deadline }) => useSecondsLeft(deadline), {
      initialProps: { deadline: NOW + 3_000 },
    })

    rerender({ deadline: NOW + 10_000 })

    expect(result.current).toBe(10)
  })
})
