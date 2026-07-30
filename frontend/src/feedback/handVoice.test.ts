import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHandVoice } from './handVoice'

/** 재생된 음성의 파일명을 순서대로 모은다. 어떤 말이 나갔는지가 이 모듈의 관심사다. */
function trackPlayback() {
  const played: string[] = []
  const paused: string[] = []
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLAudioElement,
  ) {
    played.push(fileName(this.src))
    return Promise.resolve()
  })
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLAudioElement,
  ) {
    paused.push(fileName(this.src))
  })
  return { paused, played }
}

function fileName(src: string) {
  return src.slice(src.lastIndexOf('/') + 1)
}

describe('createHandVoice', () => {
  let playback: ReturnType<typeof trackPlayback>

  beforeEach(() => {
    playback = trackPlayback()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('족보에 맞는 음성을 재생한다', () => {
    const voice = createHandVoice()

    voice.play('yacht')
    voice.play('fourOfAKind')

    expect(playback.played).toEqual(['yacht.wav', 'four-of-a-kind.wav'])
    voice.dispose()
  })

  it('앞선 콜아웃이 아직 말하는 중이면 끊고 새 족보를 외친다', () => {
    const voice = createHandVoice()

    voice.play('smallStraight')
    voice.play('largeStraight')

    expect(playback.paused).toContain('small-straight.wav')
    expect(playback.played).toEqual(['small-straight.wav', 'large-straight.wav'])
    voice.dispose()
  })

  it('음소거 상태에서는 아무 소리도 내지 않는다', () => {
    const voice = createHandVoice({ muted: true })

    voice.play('yacht')

    expect(playback.played).toEqual([])
    voice.dispose()
  })

  it('재생 중에 음소거하면 즉시 멈춘다', () => {
    const voice = createHandVoice()
    voice.play('fullHouse')

    voice.setMuted(true)
    voice.play('yacht')

    expect(playback.paused).toContain('full-house.wav')
    expect(playback.played).toEqual(['full-house.wav'])
    voice.dispose()
  })

  it('첫 사용자 제스처에서 다섯 음성을 무음으로 예열해 자동재생 잠금을 푼다', () => {
    const voice = createHandVoice()

    document.dispatchEvent(new Event('pointerdown'))

    // 굴림 완료는 탭보다 한참 뒤라 이 예열 없이는 iOS에서 첫 족보 음성이 막힌다.
    expect(playback.played).toHaveLength(5)
    expect(playback.played).toContain('yacht.wav')
    voice.dispose()
  })

  it('dispose 뒤에는 제스처가 음성을 예열하지 않는다', () => {
    const voice = createHandVoice()
    voice.dispose()

    document.dispatchEvent(new Event('pointerdown'))

    expect(playback.played).toEqual([])
  })
})
