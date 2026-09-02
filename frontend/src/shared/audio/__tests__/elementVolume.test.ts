import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadModule() {
  vi.resetModules()
  return import('../elementVolume')
}

function readOnlyVolumeAudio() {
  const audio = document.createElement('audio')
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

/** 0%는 muted로도 막고, 그보다 크면 풀어야 한다 — 볼륨 속성이 읽기 전용인 기기의 계약이다. */
function expectMutedAtZero(setElementVolume: (audio: HTMLAudioElement, level: number) => void) {
  const audio = readOnlyVolumeAudio()

  setElementVolume(audio, 0)
  expect(audio.muted).toBe(true)

  setElementVolume(audio, 0.5)
  expect(audio.muted).toBe(false)
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

  it('Web Audio가 있으면 volume 대입이 먹는지와 무관하게 GainNode로 줄인다', async () => {
    const { gain } = stubAudioContext()
    const { setElementVolume } = await loadModule()

    setElementVolume(readOnlyVolumeAudio(), 0.35)
    expect(gain.gain.value).toBeCloseTo(0.35)

    setElementVolume(document.createElement('audio'), 0.2)
    expect(gain.gain.value).toBeCloseTo(0.2)
  })

  it('0%는 GainNode와 별개로 muted로도 막는다', async () => {
    stubAudioContext()
    const { setElementVolume } = await loadModule()
    expectMutedAtZero(setElementVolume)
  })

  it('Web Audio도 없으면 최소한 0%는 무음으로 만든다', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { setElementVolume } = await loadModule()
    expectMutedAtZero(setElementVolume)
  })
})
