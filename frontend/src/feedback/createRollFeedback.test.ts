import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRollFeedback } from './createRollFeedback'

const vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true)

function installVibrate(supported = true) {
  vibrate.mockClear()
  if (supported) {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    return
  }
  Reflect.deleteProperty(navigator, 'vibrate')
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'vibrate')
  Reflect.deleteProperty(document, 'hidden')
  vi.restoreAllMocks()
})

describe('createRollFeedback', () => {
  it('제스처 단계마다 구분되는 진동 패턴을 낸다', () => {
    installVibrate()
    setHidden(false)
    const feedback = createRollFeedback()

    feedback.armed()
    feedback.thrown()
    feedback.error()

    expect(vibrate.mock.calls.map(([pattern]) => pattern)).toEqual([24, [20, 20, 45], [35, 30, 35]])
  })

  it('shakePulse는 세기에 비례한 짧은 진동을 낸다', () => {
    installVibrate()
    setHidden(false)
    vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const feedback = createRollFeedback()

    feedback.shakePulse('left', 0)
    expect(vibrate).toHaveBeenLastCalledWith(10)

    vi.spyOn(performance, 'now').mockReturnValue(1_200)
    feedback.shakePulse('right', 1)
    expect(vibrate).toHaveBeenLastCalledWith(18)

    // 세기는 1로 잘린다 — 센서 튐이 과한 진동으로 새지 않게.
    vi.spyOn(performance, 'now').mockReturnValue(1_400)
    feedback.shakePulse('right', 12)
    expect(vibrate).toHaveBeenLastCalledWith(18)
  })

  it('연속 흔들림은 80ms 안에서 한 번만 진동한다', () => {
    installVibrate()
    setHidden(false)
    const now = vi.spyOn(performance, 'now')
    const feedback = createRollFeedback()

    now.mockReturnValue(1_000)
    feedback.shakePulse('left', 0.5)
    now.mockReturnValue(1_050)
    feedback.shakePulse('right', 0.5)
    now.mockReturnValue(1_090)
    feedback.shakePulse('left', 0.5)

    expect(vibrate).toHaveBeenCalledTimes(2)
  })

  it('dispose는 남은 진동을 멈춘다', () => {
    installVibrate()
    setHidden(false)
    createRollFeedback().dispose()

    expect(vibrate).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('탭이 백그라운드면 진동하지 않는다 — 다른 화면에서 주머니가 울리지 않게', () => {
    installVibrate()
    setHidden(true)
    const feedback = createRollFeedback()

    feedback.armed()
    feedback.thrown()

    expect(vibrate).not.toHaveBeenCalled()
  })

  it('vibrate를 지원하지 않는 브라우저에서도 조용히 넘어간다', () => {
    installVibrate(false)
    setHidden(false)
    const feedback = createRollFeedback()

    expect(() => {
      feedback.armed()
      feedback.shakePulse('left', 1)
      feedback.thrown()
      feedback.error()
      feedback.dispose()
    }).not.toThrow()
  })
})
