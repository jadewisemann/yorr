import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * iOS는 `<audio>`의 `.volume` 대입을 조용히 무시한다 — 슬라이더를 0%로 내려도 소리가 났다.
 * 그 환경을 흉내내(볼륨 setter가 값을 안 받는 요소) GainNode 경로로 넘어가는지만 본다.
 *
 * 모듈이 "이 브라우저에서 대입이 먹는가"를 한 번만 재고 캐시하므로 테스트마다 새로 import한다.
 */

async function loadModule() {
  vi.resetModules()
  return import('../elementVolume')
}

function readOnlyVolumeAudio() {
  const audio = document.createElement('audio')
  // iOS와 같은 성질: 대입해도 예외 없이 무시되고 값은 그대로 1이다.
  Object.defineProperty(audio, 'volume', { configurable: true, get: () => 1, set: () => undefined })
  return audio
}

function stubAudioContext() {
  const gain = { connect: vi.fn(), gain: { value: 1 } }
  const resume = vi.fn(async () => undefined)
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      destination = {}
      resume = resume
      createGain = () => gain
      createMediaElementSource = () => ({ connect: () => gain })
    },
  )
  return { gain, resume }
}

describe('setElementVolume', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('Web Audio가 없으면 종전대로 volume에 넣는다', async () => {
    const { setElementVolume } = await loadModule()
    const audio = document.createElement('audio')

    setElementVolume(audio, 0.35)

    expect(audio.volume).toBeCloseTo(0.35)
  })

  // 대입이 먹는지 재보고 갈래를 타면 iOS에 속는다 — 무시하면서 값은 저장하기 때문이다.
  // 그래서 요소가 뭐라고 답하든 GainNode로 간다.
  it('Web Audio가 있으면 volume 대입이 먹는지와 무관하게 GainNode로 줄인다', async () => {
    const { gain } = stubAudioContext()
    const { setElementVolume } = await loadModule()

    setElementVolume(readOnlyVolumeAudio(), 0.35)
    expect(gain.gain.value).toBeCloseTo(0.35)

    // 대입이 정상인 요소도 같은 경로를 탄다(갈래가 없다).
    setElementVolume(document.createElement('audio'), 0.2)
    expect(gain.gain.value).toBeCloseTo(0.2)
  })

  it('0%는 GainNode와 별개로 muted로도 막는다', async () => {
    stubAudioContext()
    const { setElementVolume } = await loadModule()
    const audio = readOnlyVolumeAudio()

    setElementVolume(audio, 0)
    expect(audio.muted).toBe(true)

    setElementVolume(audio, 0.5)
    expect(audio.muted).toBe(false)
  })

  it('Web Audio도 없으면 최소한 0%는 무음으로 만든다', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { setElementVolume } = await loadModule()
    const audio = readOnlyVolumeAudio()

    setElementVolume(audio, 0)
    expect(audio.muted).toBe(true)

    setElementVolume(audio, 0.5)
    expect(audio.muted).toBe(false)
  })
})
