import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionInputController } from './MotionInputController'
import type { MotionAvailability } from './motionTypes'

const originalDeviceMotion = Object.getOwnPropertyDescriptor(window, 'DeviceMotionEvent')
const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')

describe('MotionInputController', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (originalDeviceMotion) {
      Object.defineProperty(window, 'DeviceMotionEvent', originalDeviceMotion)
    } else {
      Reflect.deleteProperty(window, 'DeviceMotionEvent')
    }
    if (originalSecureContext) {
      Object.defineProperty(window, 'isSecureContext', originalSecureContext)
    } else {
      Reflect.deleteProperty(window, 'isSecureContext')
    }
  })

  it('지원하지 않는 환경을 즉시 fallback 상태로 알린다', () => {
    Reflect.deleteProperty(window, 'DeviceMotionEvent')
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()

    expect(availability).toEqual(['unsupported'])
    controller.destroy()
  })

  it('iOS 권한을 명시적으로 허용한 뒤에만 listener를 등록한다', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    Object.defineProperty(window, 'DeviceMotionEvent', {
      configurable: true,
      value: Object.assign(function MockDeviceMotionEvent() {}, { requestPermission }),
    })
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    expect(availability).toEqual(['permissionRequired'])
    expect(addEventListener).not.toHaveBeenCalledWith('devicemotion', expect.any(Function))

    await controller.requestPermission()

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(addEventListener).toHaveBeenCalledWith('devicemotion', expect.any(Function))
    expect(availability).toContain('listening')
    controller.destroy()
  })

  it('requestPermission API가 없는 브라우저도 사용자 확인 후 listener를 등록한다', async () => {
    Object.defineProperty(window, 'DeviceMotionEvent', {
      configurable: true,
      value: function MockDeviceMotionEvent() {},
    })
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    expect(availability).toEqual(['permissionRequired'])
    expect(addEventListener).not.toHaveBeenCalledWith('devicemotion', expect.any(Function))

    await controller.requestPermission()

    expect(addEventListener).toHaveBeenCalledWith('devicemotion', expect.any(Function))
    expect(availability).toContain('listening')
    controller.destroy()
  })

  it('iOS에서 권한을 거부하면 listener 없이 탭 fallback 상태가 된다', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    installDeviceMotionApi(requestPermission)
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    await controller.requestPermission()

    expect(availability).toEqual(['permissionRequired', 'requesting', 'denied'])
    expect(addEventListener).not.toHaveBeenCalledWith('devicemotion', expect.any(Function))
    controller.destroy()
  })

  it('권한 응답 전에 destroy되면 listener를 뒤늦게 등록하지 않는다', async () => {
    let resolvePermission: ((result: 'granted') => void) | undefined
    const requestPermission = vi.fn(
      () =>
        new Promise<'granted'>((resolve) => {
          resolvePermission = resolve
        }),
    )
    installDeviceMotionApi(requestPermission)
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    const pendingPermission = controller.requestPermission()
    controller.destroy()
    resolvePermission?.('granted')
    await pendingPermission

    expect(addEventListener).not.toHaveBeenCalledWith('devicemotion', expect.any(Function))
  })

  it('destroy 뒤 권한 요청이 실패해도 availability를 갱신하지 않는다', async () => {
    let rejectPermission: ((reason: Error) => void) | undefined
    const requestPermission = vi.fn(
      () =>
        new Promise<'granted'>((_, reject) => {
          rejectPermission = reject
        }),
    )
    installDeviceMotionApi(requestPermission)
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    const pendingPermission = controller.requestPermission()
    controller.destroy()
    rejectPermission?.(new Error('permission prompt dismissed'))
    await pendingPermission

    expect(availability).toEqual(['permissionRequired', 'requesting'])
  })

  it('값이 비어 있는 motion 이벤트는 silent fallback 타이머를 연장하지 않는다', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'DeviceMotionEvent', {
      configurable: true,
      value: function MockDeviceMotionEvent() {},
    })
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    await controller.requestPermission()
    vi.advanceTimersByTime(600)
    window.dispatchEvent(
      Object.assign(new Event('devicemotion'), {
        acceleration: null,
        accelerationIncludingGravity: null,
      }),
    )
    vi.advanceTimersByTime(100)

    expect(availability.at(-1)).toBe('silent')
    controller.destroy()
  })

  it('HTTPS가 아니면 iPhone 센서 권한을 요청하지 않는다', () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    installDeviceMotionApi(requestPermission)
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()

    expect(availability).toEqual(['insecure'])
    expect(requestPermission).not.toHaveBeenCalled()
    controller.destroy()
  })
})

function createController(availability: MotionAvailability[]) {
  return new MotionInputController({
    onAvailabilityChange: (value) => availability.push(value),
    onGestureEvent: vi.fn(),
    onGestureSnapshot: vi.fn(),
  })
}

function installDeviceMotionApi(requestPermission: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'DeviceMotionEvent', {
    configurable: true,
    value: Object.assign(function MockDeviceMotionEvent() {}, { requestPermission }),
  })
}
