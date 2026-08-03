import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'
import { useMotionRollInput } from '@/yacht/input/useMotionRollInput'

const originalDeviceMotion = Object.getOwnPropertyDescriptor(window, 'DeviceMotionEvent')

function installDeviceMotionEvent() {
  Object.defineProperty(window, 'DeviceMotionEvent', {
    configurable: true,
    value: function MockDeviceMotionEvent() {},
  })
}

function dispatchMotion(timeStamp: number, x: number, y: number) {
  const event = Object.assign(new Event('devicemotion'), {
    acceleration: { x, y, z: 0 },
    accelerationIncludingGravity: null,
  })
  Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp })
  window.dispatchEvent(event)
}

afterEach(() => {
  if (originalDeviceMotion) {
    Object.defineProperty(window, 'DeviceMotionEvent', originalDeviceMotion)
  } else {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')
  }
  vi.restoreAllMocks()
})

describe('useMotionRollInput', () => {
  it('센서를 지원하지 않으면 탭 입력 모드로 떨어진다', () => {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')

    const { result } = renderHook(() => useMotionRollInput(vi.fn()))

    expect(result.current.availability).toBe('unsupported')
    expect(result.current.inputMode).toBe('tap')
  })

  /**
   * 파티 모드 대시보드(턴을 가질 수 없는 화면)에서 센서를 켜지 않기 위한 스위치다.
   * 센서를 지원하는 기기에서도 권한을 묻지 않아야 하므로 DeviceMotionEvent를 심어 두고 본다 —
   * 여기서 permissionRequired가 나오면 TV·모니터가 모션 권한을 묻는다는 뜻이다.
   */
  it('enabled=false면 센서를 시작하지 않는다', () => {
    installDeviceMotionEvent()

    const { result } = renderHook(() => useMotionRollInput(vi.fn(), false))

    expect(result.current.availability).toBe('unknown')
    expect(result.current.inputMode).toBe('tap')
  })

  it('권한 대기 중에도 탭으로 굴릴 수 있게 둔다', () => {
    installDeviceMotionEvent()

    const { result } = renderHook(() => useMotionRollInput(vi.fn()))

    expect(result.current.availability).toBe('permissionRequired')
    expect(result.current.inputMode).toBe('tap')
  })

  it('권한을 허용하면 모션 입력 모드로 올라가고 초기 스냅샷을 노출한다', async () => {
    installDeviceMotionEvent()
    const { result } = renderHook(() => useMotionRollInput(vi.fn()))

    await act(async () => {
      await result.current.requestPermission()
    })

    expect(result.current.availability).toBe('listening')
    expect(result.current.inputMode).toBe('motion')
    expect(result.current).toMatchObject({
      calibrated: false,
      canConfirmThrow: false,
      gestureState: 'idle',
      reversalCount: 0,
    })
  })

  it('센서 샘플이 들어오면 스냅샷을 갱신한다', async () => {
    installDeviceMotionEvent()
    const { result } = renderHook(() => useMotionRollInput(vi.fn()))
    await act(async () => {
      await result.current.requestPermission()
    })

    act(() => {
      dispatchMotion(100, 7, -4)
    })

    expect(result.current.gestureState).toBe('calibrating')
  })

  it('제스처 이벤트는 최신 콜백으로 전달한다', async () => {
    installDeviceMotionEvent()
    const first = vi.fn<(event: MotionGestureEvent) => void>()
    const second = vi.fn<(event: MotionGestureEvent) => void>()
    const { result, rerender } = renderHook(
      ({ onEvent }: { onEvent: (event: MotionGestureEvent) => void }) =>
        useMotionRollInput(onEvent),
      { initialProps: { onEvent: first } },
    )
    await act(async () => {
      await result.current.requestPermission()
    })
    act(() => {
      dispatchMotion(100, 7, -4)
    })

    rerender({ onEvent: second })
    act(() => {
      result.current.resetGesture('manual')
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gestureCancelled', reason: 'manual' }),
    )
  })

  it('언마운트 뒤 호출은 조용히 넘어간다', async () => {
    installDeviceMotionEvent()
    const { result, unmount } = renderHook(() => useMotionRollInput(vi.fn()))
    const { requestPermission, resetGesture } = result.current

    unmount()

    await expect(requestPermission()).resolves.toBeUndefined()
    expect(() => resetGesture()).not.toThrow()
  })
})
