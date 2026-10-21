import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { advanceSwing, type SwingState, useSwing } from '../useSwing'

const originalDeviceMotion = Object.getOwnPropertyDescriptor(window, 'DeviceMotionEvent')

afterEach(() => {
  vi.restoreAllMocks()
  if (originalDeviceMotion) {
    Object.defineProperty(window, 'DeviceMotionEvent', originalDeviceMotion)
  } else {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')
  }
})

describe('useSwing', () => {
  it('automatically connects Android-style motion events and detects a swing', async () => {
    installDeviceMotionEvent()
    const onSwing = vi.fn()
    const { result } = renderHook(() => useSwing({ onSwing }))

    await waitFor(() => expect(result.current.permission).toBe('granted'))

    act(() => {
      window.dispatchEvent(motionEvent(0))
      window.dispatchEvent(motionEvent(30))
    })

    expect(onSwing).toHaveBeenCalledOnce()
  })

  it('waits for an explicit iOS permission gesture before connecting motion events', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    installDeviceMotionEvent(requestPermission)
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const { result } = renderHook(() => useSwing({ onSwing: vi.fn() }))

    expect(result.current.permission).toBe('unknown')
    expect(addEventListener.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(0)

    await act(() => result.current.requestPermission())

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(result.current.permission).toBe('granted')
    expect(addEventListener.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(1)
  })

  it('keeps one motion listener while input is disabled and enabled between game phases', async () => {
    installDeviceMotionEvent()
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const onSwing = vi.fn()
    const { rerender, result } = renderHook(({ enabled }) => useSwing({ enabled, onSwing }), {
      initialProps: { enabled: true },
    })

    await waitFor(() => expect(result.current.permission).toBe('granted'))
    rerender({ enabled: false })
    rerender({ enabled: true })

    expect(addEventListener.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(1)
    act(() => {
      window.dispatchEvent(motionEvent(0))
      window.dispatchEvent(motionEvent(30))
    })
    expect(onSwing).toHaveBeenCalledOnce()
  })

  it('reports unsupported when the browser has no DeviceMotion API', async () => {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')
    const { result } = renderHook(() => useSwing({ onSwing: vi.fn() }))

    await waitFor(() => expect(result.current.permission).toBe('unsupported'))
  })
})

function installDeviceMotionEvent(requestPermission?: () => Promise<'granted' | 'denied'>) {
  const DeviceMotion = function MockDeviceMotionEvent() {}
  Object.defineProperty(window, 'DeviceMotionEvent', {
    configurable: true,
    value: requestPermission ? Object.assign(DeviceMotion, { requestPermission }) : DeviceMotion,
  })
}

function motionEvent(x: number) {
  return Object.assign(new Event('devicemotion'), {
    acceleration: { x, y: 0, z: 0 },
    accelerationIncludingGravity: null,
  }) as DeviceMotionEvent
}

/**
 * 스윙 판정 규칙 — 히스테리시스(놓아야 다시 무장)와 쿨다운.
 *
 * 훅이 아니라 순수 함수로 시험한다: 이 규칙이 깨지면 "한 번 흔들었는데 두 번
 * 굴러간다" 또는 "세게 흔들어도 안 굴러간다"가 되는데, 이벤트를 흉내내면 그 두
 * 증상이 구분되지 않는다.
 */
describe('advanceSwing', () => {
  const THRESHOLD = 14
  const fresh = (): SwingState => ({ armed: true, lastSwingAt: 0 })
  const sample = (magnitude: number, now: number) => ({ magnitude, threshold: THRESHOLD, now })

  it('임계값 미만은 스윙이 아니다', () => {
    const state = fresh()
    expect(advanceSwing(state, sample(THRESHOLD - 0.1, 1_000))).toBe(false)
    // 임계값에 도달하면 발화한다(경계 포함 — "이 이상이면 스윙").
    expect(advanceSwing(state, sample(THRESHOLD, 1_000))).toBe(true)
  })

  it('임계값을 넘으면 발화하고 무장이 풀린다', () => {
    const state = fresh()
    expect(advanceSwing(state, sample(THRESHOLD + 1, 1_000))).toBe(true)
    expect(state.armed).toBe(false)
    expect(state.lastSwingAt).toBe(1_000)
  })

  it('무장이 풀린 동안에는 다시 발화하지 않는다 — 한 번의 흔들림은 한 번', () => {
    const state = fresh()
    advanceSwing(state, sample(40, 1_000))
    // 계속 세게 흔들어도(놓지 않았으므로) 두 번째는 없다.
    expect(advanceSwing(state, sample(40, 1_100))).toBe(false)
    expect(advanceSwing(state, sample(60, 1_200))).toBe(false)
  })

  it('충분히 놓으면 다시 무장한다', () => {
    const state = fresh()
    advanceSwing(state, sample(40, 1_000))
    expect(advanceSwing(state, sample(THRESHOLD * 0.45 - 0.1, 1_100))).toBe(false)
    expect(state.armed).toBe(true)
    expect(advanceSwing(state, sample(40, 1_400))).toBe(true)
  })

  it('쿨다운 안의 두 번째 스윙은 버린다', () => {
    const state = fresh()
    expect(advanceSwing(state, sample(40, 1_000))).toBe(true)
    // 놓아서 무장은 됐지만 쿨다운이 남았다.
    advanceSwing(state, sample(1, 1_050))
    expect(advanceSwing(state, sample(40, 1_150))).toBe(false)
    // 쿨다운이 지나면 발화한다.
    expect(advanceSwing(state, sample(40, 1_300))).toBe(true)
  })
})
