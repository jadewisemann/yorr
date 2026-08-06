import { afterEach, describe, expect, it, vi } from 'vitest'
import { vibrate } from '@/shared/vibrate'

function stubVibrate(fn: unknown) {
  vi.stubGlobal('navigator', Object.assign(navigator, { vibrate: fn }))
}

/** jsdom의 document.hidden은 getter라 값으로 덮어써야 한다. */
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

  // 진동이 없는 기기(아이폰 전부)에서 게임이 멈추면 안 된다 — 진동은 늘 보조 신호다.
  it('Vibration API가 없는 기기에서 조용히 넘어간다', () => {
    stubVibrate(undefined)
    expect(() => vibrate(20)).not.toThrow()
  })

  // 다른 앱을 보는 동안에도 서버 상태는 계속 흐른다. 보이지 않는 화면 때문에 주머니 속
  // 폰이 떨면 게임 피드백이 아니라 고장으로 읽힌다.
  it('탭이 숨어 있으면 울리지 않는다', () => {
    const spy = vi.fn()
    stubVibrate(spy)
    stubHidden(true)
    vibrate(20)
    expect(spy).not.toHaveBeenCalled()
  })
})
