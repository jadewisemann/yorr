import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSwing } from '../useSwing'

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
