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

/**
 * 소리 요소는 모듈이 로드될 때 만들어진다(iOS 잠금 때문에 앱 시작에 만들어 둔다).
 * 그래서 Audio를 먼저 갈아끼우고 모듈을 새로 불러와야 스텁이 잡힌다.
 */
async function loadFeedback() {
  vi.resetModules()
  const audio = stubAudio()
  const { createRollFeedback } = await import('./createRollFeedback')
  return { audio, createRollFeedback }
}

/** src로 찾는다 — 생성 순서에 기대면 소리를 하나 추가할 때마다 인덱스가 밀린다. */
function stubAudio() {
  const created: HTMLAudioElement[] = []
  vi.stubGlobal(
    'Audio',
    vi.fn(function AudioMock(src?: string) {
      const audio = document.createElement('audio')
      if (src) audio.setAttribute('src', src)
      // jsdom의 paused는 재생을 흉내내지 않는다. "이미 나고 있으면 다시 틀지 않는다"를
      // 검사하려면 play/pause가 실제로 상태를 바꿔야 한다.
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

    // 세기는 1로 잘린다 — 센서 튐이 과한 진동으로 새지 않게.
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

  /**
   * 요소를 게임 화면에서 만들면 iOS에서는 그 화면을 만지기 전까지 잠겨 있다 — 관전자는
   * 화면을 만질 일이 없어 방장의 1라운드 굴림 소리가 통째로 빠졌다. 앱이 뜰 때 만들어
   * 두면 앞 화면에서 누른 첫 탭이 같이 풀어준다.
   */
  it('소리 요소는 게임 화면 진입이 아니라 앱 시작에 만들어 첫 제스처로 잠금이 풀린다', async () => {
    const { audio } = await loadFeedback()
    const shake = audio(SHAKE)

    // createRollFeedback을 부르기 전 — 모듈 로드만으로 이미 있다.
    expect(shake).toBeDefined()

    document.dispatchEvent(new Event('pointerdown'))

    // 제스처 안에서 한 번 재생했다 즉시 멈춰 둔다(소리는 나지 않는다).
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

    // 사발을 엎는 순간 흔드는 소리가 멈추고 엎는 소리가 한 번 난다(loop 아님).
    feedback.phaseChanged('pouring')
    expect(shake?.pause).toHaveBeenCalledOnce()
    expect(pour?.loop).toBe(false)
    expect(pour?.play).toHaveBeenCalledOnce()

    // 정렬·대기 단계에서는 엎는 소리가 다시 나지 않는다.
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

    // 손이 멈췄다 — 사발 안 주사위도 잦아드는 구간이라 소리도 멈춘다.
    vi.advanceTimersByTime(100)
    expect(shake?.pause).toHaveBeenCalledOnce()

    // 다시 흔들면 되살아난다. 멈춘 자리에서 이어 재생하므로 덜그럭이 끊겨 들리지 않는다.
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

    // 굴리는 사람이 손을 멈추면 중계도 끊긴다 — 관전 화면의 사발도 소리도 같이 멈춘다.
    vi.advanceTimersByTime(100)
    expect(shake?.pause).toHaveBeenCalledOnce()

    // 남의 손놀림이라 내 폰이 울릴 이유는 없다.
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('버튼으로 굴리면 펄스가 없어도 사발 소리가 계속 난다', async () => {
    const { audio, createRollFeedback } = await loadFeedback()
    vi.useFakeTimers()
    const feedback = createRollFeedback()
    const shake = audio(SHAKE)

    // 탭 굴림은 정해진 애니메이션으로 계속 흔들린다 — 멈출 근거가 없다.
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
