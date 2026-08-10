import { afterEach, describe, expect, it, vi } from 'vitest'

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

const SHAKE = '/audio/game/bowl-shake.wav'
const POUR = '/audio/game/bowl-pour.wav'
const HIT = '/audio/game/dice-hit.mp3'

async function loadFeedback() {
  vi.resetModules()
  const audio = stubAudio()
  const { createRollFeedback } = await import('@/yacht/feedback/createRollFeedback')
  return { audio, createRollFeedback }
}

function stubAudio() {
  const created: HTMLAudioElement[] = []
  vi.stubGlobal(
    'Audio',
    vi.fn(function AudioMock(src?: string) {
      const audio = document.createElement('audio')
      if (src) audio.setAttribute('src', src)
      let paused = true
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused })
      audio.play = vi.fn(() => {
        paused = false
        return Promise.resolve()
      })
      audio.pause = vi.fn(() => {
        paused = true
      })
      created.push(audio)
      return audio
    }),
  )
  return (src: string, index = 0) =>
    created.filter((audio) => audio.getAttribute('src') === src)[index]
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'vibrate')
  Reflect.deleteProperty(document, 'hidden')
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createRollFeedback', () => {
  it('제스처 단계마다 구분되는 진동 패턴을 낸다', async () => {
    const { createRollFeedback } = await loadFeedback()
    installVibrate()
    setHidden(false)
    const feedback = createRollFeedback()

    feedback.armed()
    feedback.thrown()
    feedback.error()

    expect(vibrate.mock.calls.map(([pattern]) => pattern)).toEqual([24, [20, 20, 45], [35, 30, 35]])
  })

  it('shakePulse는 세기에 비례한 짧은 진동을 낸다', async () => {
    const { createRollFeedback } = await loadFeedback()
    installVibrate()
    setHidden(false)
    vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const feedback = createRollFeedback()

    feedback.shakePulse('left', 0)
    expect(vibrate).toHaveBeenLastCalledWith(10)

    vi.spyOn(performance, 'now').mockReturnValue(1_200)
    feedback.shakePulse('right', 1)
    expect(vibrate).toHaveBeenLastCalledWith(18)

    vi.spyOn(performance, 'now').mockReturnValue(1_400)
    feedback.shakePulse('right', 12)
    expect(vibrate).toHaveBeenLastCalledWith(18)
  })

  it('연속 흔들림은 80ms 안에서 한 번만 진동한다', async () => {
    const { createRollFeedback } = await loadFeedback()
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

  it('dispose는 남은 진동을 멈춘다', async () => {
    const { createRollFeedback } = await loadFeedback()
    installVibrate()
    setHidden(false)
    createRollFeedback().dispose()

    expect(vibrate).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('탭이 백그라운드면 진동하지 않는다 — 다른 화면에서 주머니가 울리지 않게', async () => {
    const { createRollFeedback } = await loadFeedback()
    installVibrate()
    setHidden(true)
    const feedback = createRollFeedback()

    feedback.armed()
    feedback.thrown()

    expect(vibrate).not.toHaveBeenCalled()
  })

  it('vibrate를 지원하지 않는 브라우저에서도 조용히 넘어간다', async () => {
    const { createRollFeedback } = await loadFeedback()
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

  it('소리 요소는 게임 화면 진입이 아니라 앱 시작에 만들어 첫 제스처로 잠금이 풀린다', async () => {
    const { audio } = await loadFeedback()
    const shake = audio(SHAKE)

    expect(shake).toBeDefined()

    document.dispatchEvent(new Event('pointerdown'))

    expect(shake?.play).toHaveBeenCalledOnce()
    expect(shake?.pause).toHaveBeenCalledOnce()
  })

  it('흔들기(loop) → 엎기(1회) → 주사위 부딪힘 3단계로 소리가 난다', async () => {
    const { audio, createRollFeedback } = await loadFeedback()
    const feedback = createRollFeedback()
    const shake = audio(SHAKE)
    const pour = audio(POUR)
    const secondDie = audio(HIT, 1)

    feedback.phaseChanged('shaking')
    expect(shake?.loop).toBe(true)
    expect(shake?.play).toHaveBeenCalledOnce()
    expect(pour?.play).not.toHaveBeenCalled()

    feedback.diceImpact(1, 0.5)
    expect(secondDie?.play).toHaveBeenCalledOnce()
    expect(secondDie?.volume).toBeCloseTo(0.475)

    feedback.phaseChanged('pouring')
    expect(shake?.pause).toHaveBeenCalledOnce()
    expect(pour?.loop).toBe(false)
    expect(pour?.play).toHaveBeenCalledOnce()

    feedback.phaseChanged('aligning')
    feedback.phaseChanged('idle')
    expect(pour?.play).toHaveBeenCalledOnce()
  })

  it('흔들기를 멈추면 사발 소리도 멈추고, 다시 흔들면 이어서 난다', async () => {
    const { audio, createRollFeedback } = await loadFeedback()
    vi.useFakeTimers()
    const feedback = createRollFeedback()
    const shake = audio(SHAKE)
    feedback.phaseChanged('shaking')

    feedback.shakePulse('left', 0.5)
    vi.advanceTimersByTime(200)
    expect(shake?.pause).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(shake?.pause).toHaveBeenCalledOnce()

    feedback.shakePulse('right', 0.5)
    expect(shake?.play).toHaveBeenCalledTimes(2)
  })

  it('남이 흔드는 것도 소리는 같이 따라가되 진동은 내지 않는다', async () => {
    const { audio, createRollFeedback } = await loadFeedback()
    vi.useFakeTimers()
    installVibrate()
    setHidden(false)
    const feedback = createRollFeedback()
    const shake = audio(SHAKE)
    feedback.phaseChanged('shaking')

    feedback.remoteShakePulse()
    vi.advanceTimersByTime(200)
    expect(shake?.pause).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(shake?.pause).toHaveBeenCalledOnce()

    expect(vibrate).not.toHaveBeenCalled()
  })

  it('버튼으로 굴리면 펄스가 없어도 사발 소리가 계속 난다', async () => {
    const { audio, createRollFeedback } = await loadFeedback()
    vi.useFakeTimers()
    const feedback = createRollFeedback()
    const shake = audio(SHAKE)

    feedback.phaseChanged('shaking')
    vi.advanceTimersByTime(5_000)

    expect(shake?.pause).not.toHaveBeenCalled()
  })

  it('setMuted(true)면 재생 중인 소리를 전부 멈추고, 다시 켜면 흔드는 중이던 사발을 되살린다', async () => {
    const { audio, createRollFeedback } = await loadFeedback()
    const feedback = createRollFeedback()
    const shake = audio(SHAKE)
    const secondDie = audio(HIT, 1)
    feedback.phaseChanged('shaking')

    feedback.setMuted(true)
    expect(shake?.pause).toHaveBeenCalledOnce()
    expect(secondDie?.pause).toHaveBeenCalledOnce()

    feedback.setMuted(false)
    expect(shake?.play).toHaveBeenCalledTimes(2)
  })

  it('음소거 상태에서는 흔들려도 사발 소리가 나지 않고, 굴리는 소리도 무시된다', async () => {
    const { audio, createRollFeedback } = await loadFeedback()
    const feedback = createRollFeedback({ muted: true })
    const shake = audio(SHAKE)
    const pour = audio(POUR)
    const secondDie = audio(HIT, 1)

    feedback.phaseChanged('shaking')
    expect(shake?.play).not.toHaveBeenCalled()

    feedback.phaseChanged('pouring')
    expect(pour?.play).not.toHaveBeenCalled()

    feedback.diceImpact(1, 0.5)
    expect(secondDie?.play).not.toHaveBeenCalled()
  })
})
