import { afterEach, describe, expect, it, vi } from 'vitest'
import { vibrate } from '@/shared/vibrate'

function stubVibrate(fn: unknown) {
  vi.stubGlobal('navigator', Object.assign(navigator, { vibrate: fn }))
}

function stubHidden(hidden: boolean) {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
}

describe('vibrate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('지원하는 기기에서 패턴을 그대로 넘긴다', () => {
    const spy = vi.fn()
    stubVibrate(spy)
    vibrate([40, 60, 40])
    expect(spy).toHaveBeenCalledWith([40, 60, 40])
  })

  it('Vibration API가 없는 기기에서 조용히 넘어간다', () => {
    stubVibrate(undefined)
    expect(() => vibrate(20)).not.toThrow()
  })

  it('탭이 숨어 있으면 울리지 않는다', () => {
    const spy = vi.fn()
    stubVibrate(spy)
    stubHidden(true)
    vibrate(20)
    expect(spy).not.toHaveBeenCalled()
  })
})
