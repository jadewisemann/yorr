import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionInputController } from './MotionInputController'
import type { MotionAvailability, MotionGestureEvent, MotionGestureSnapshot } from './motionTypes'

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
    Reflect.deleteProperty(document, 'hidden')
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

  it('destroy된 컨트롤러는 다시 start해도 아무 상태도 알리지 않는다', () => {
    installDeviceMotionEvent()
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.destroy()
    controller.start()

    expect(availability).toEqual([])
  })

  it('권한 요청 자체가 실패하면 error 상태로 알린다', async () => {
    installDeviceMotionApi(vi.fn().mockRejectedValue(new Error('prompt failed')))
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    await controller.requestPermission()

    expect(availability).toEqual(['permissionRequired', 'requesting', 'error'])
    controller.destroy()
  })

  it('권한 요청을 되풀이해도 devicemotion listener는 한 번만 등록한다', async () => {
    installDeviceMotionEvent()
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const controller = createController([])

    controller.start()
    await controller.requestPermission()
    await controller.requestPermission()

    expect(addEventListener.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(1)
    controller.destroy()
  })

  it('값이 있는 샘플이 들어오면 listening을 유지하고 스냅샷을 올린다', async () => {
    installDeviceMotionEvent()
    const availability: MotionAvailability[] = []
    const snapshots: MotionGestureSnapshot[] = []
    const controller = new MotionInputController({
      onAvailabilityChange: (value) => availability.push(value),
      onGestureEvent: vi.fn(),
      onGestureSnapshot: (snapshot) => snapshots.push(snapshot),
    })

    controller.start()
    await controller.requestPermission()
    dispatchMotion(100, 7, -4)
    dispatchMotion(120, -7, 4)

    expect(availability.at(-1)).toBe('listening')
    expect(snapshots.at(-1)?.gestureState).toBe('calibrating')
    controller.destroy()
  })

  it('탭이 백그라운드면 제스처를 취소하고 paused로 멈춘다', async () => {
    installDeviceMotionEvent()
    const availability: MotionAvailability[] = []
    const events: MotionGestureEvent[] = []
    const controller = new MotionInputController({
      onAvailabilityChange: (value) => availability.push(value),
      onGestureEvent: (event) => events.push(event),
      onGestureSnapshot: vi.fn(),
    })

    controller.start()
    await controller.requestPermission()
    dispatchMotion(100, 7, -4)

    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(availability.at(-1)).toBe('paused')
    expect(events.at(-1)).toMatchObject({ type: 'gestureCancelled', reason: 'background' })

    // 백그라운드 동안 들어온 샘플은 무시한다.
    dispatchMotion(140, 9, -9)
    expect(availability.at(-1)).toBe('paused')

    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(availability.at(-1)).toBe('listening')
    controller.destroy()
  })

  it('백그라운드 상태에서 권한을 허용하면 곧바로 paused로 시작한다', async () => {
    installDeviceMotionEvent()
    setHidden(true)
    const availability: MotionAvailability[] = []
    const controller = createController(availability)

    controller.start()
    await controller.requestPermission()

    expect(availability).toEqual(['permissionRequired', 'paused'])
    controller.destroy()
  })

  it('reset은 진행 중이던 제스처만 취소 이벤트로 알린다', async () => {
    installDeviceMotionEvent()
    const events: MotionGestureEvent[] = []
    const controller = new MotionInputController({
      onAvailabilityChange: vi.fn(),
      onGestureEvent: (event) => events.push(event),
      onGestureSnapshot: vi.fn(),
    })

    controller.start()
    await controller.requestPermission()
    controller.reset()
    expect(events).toEqual([])

    dispatchMotion(100, 7, -4)
    controller.reset('manual')

    expect(events).toEqual([
      expect.objectContaining({ type: 'gestureCancelled', reason: 'manual' }),
    ])
    controller.destroy()
  })
})

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
}

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
