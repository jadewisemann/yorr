import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHandVoice } from './handVoice'

/**
 * jsdom에는 Web Audio가 없어서 최소한만 흉내낸다. 검증 대상은 "어떤 말이 언제 나갔는가"와
 * "미리 디코딩해 두는가"라서, 노드 그래프는 연결 여부만 들고 있으면 충분하다.
 */
function fakeWebAudio() {
  const started: string[] = []
  const stopped: string[] = []
  const decoded: string[] = []
  let resumeCount = 0
  let lastSource: FakeBufferSource | null = null

  class FakeBufferSource {
    buffer: { tag: string } | null = null
    onended: (() => void) | null = null
    connected = false
    connect() {
      this.connected = true
    }
    start() {
      if (!this.buffer) throw new Error('buffer 없이 start')
      if (!this.connected) throw new Error('연결 없이 start')
      started.push(this.buffer.tag)
    }
    stop() {
      stopped.push(this.buffer?.tag ?? '?')
    }
  }

  class FakeAudioContext {
    state: AudioContextState = 'suspended'
    destination = {}
    createGain() {
      return { gain: { value: 0 }, connect: () => undefined }
    }
    createBufferSource() {
      lastSource = new FakeBufferSource()
      return lastSource
    }
    // 파일 경로를 그대로 태그로 실어 보내 어떤 음성이 재생됐는지 추적한다.
    decodeAudioData(data: ArrayBuffer) {
      const tag = new TextDecoder().decode(data)
      decoded.push(tag)
      return Promise.resolve({ tag })
    }
    resume() {
      resumeCount += 1
      this.state = 'running'
      return Promise.resolve()
    }
    close() {
      this.state = 'closed'
      return Promise.resolve()
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('fetch', (url: string) =>
    Promise.resolve({
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(fileName(url)).buffer),
    }),
  )

  return {
    decoded,
    started,
    stopped,
    get resumeCount() {
      return resumeCount
    },
    get lastSource() {
      return lastSource
    },
  }
}

function fileName(src: string) {
  return src.slice(src.lastIndexOf('/') + 1)
}

/** 디코딩(fetch → decodeAudioData)이 끝나기를 기다린다. 그 전에는 play()가 조용히 넘어간다. */
async function settlePreload() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe('createHandVoice', () => {
  let audio: ReturnType<typeof fakeWebAudio>

  beforeEach(() => {
    audio = fakeWebAudio()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('족보에 맞는 음성을 재생한다', async () => {
    const voice = createHandVoice()
    await settlePreload()

    voice.play('yacht')
    voice.play('fourOfAKind')

    expect(audio.started).toEqual(['yacht.wav', 'four-of-a-kind.wav'])
    voice.dispose()
  })

  it('제스처를 기다리지 않고 다섯 음성을 미리 디코딩한다', async () => {
    // iOS Safari의 <audio>는 play()마다 파이프라인을 세워 0.6~0.8초 늦게 났다.
    // 미리 디코딩해 두는 것이 그 지연을 없애는 핵심이라 여기서 못 박는다.
    const voice = createHandVoice()
    await settlePreload()

    expect([...audio.decoded].sort()).toEqual([
      'four-of-a-kind.wav',
      'full-house.wav',
      'large-straight.wav',
      'small-straight.wav',
      'yacht.wav',
    ])
    voice.dispose()
  })

  it('앞선 콜아웃이 아직 말하는 중이면 끊고 새 족보를 외친다', async () => {
    const voice = createHandVoice()
    await settlePreload()

    voice.play('smallStraight')
    voice.play('largeStraight')

    expect(audio.stopped).toEqual(['small-straight.wav'])
    expect(audio.started).toEqual(['small-straight.wav', 'large-straight.wav'])
    voice.dispose()
  })

  it('음소거 상태에서는 아무 소리도 내지 않는다', async () => {
    const voice = createHandVoice({ muted: true })
    await settlePreload()

    voice.play('yacht')

    expect(audio.started).toEqual([])
    voice.dispose()
  })

  it('재생 중에 음소거하면 즉시 멈춘다', async () => {
    const voice = createHandVoice()
    await settlePreload()
    voice.play('fullHouse')

    voice.setMuted(true)
    voice.play('yacht')

    expect(audio.stopped).toEqual(['full-house.wav'])
    expect(audio.started).toEqual(['full-house.wav'])
    voice.dispose()
  })

  it('첫 사용자 제스처에서 AudioContext 잠금을 푼다', async () => {
    const voice = createHandVoice()
    await settlePreload()

    document.dispatchEvent(new Event('pointerdown'))

    // 굴림 완료는 탭보다 한참 뒤라 이 해제 없이는 iOS에서 첫 족보 음성이 막힌다.
    expect(audio.resumeCount).toBe(1)
    voice.dispose()
  })

  it('제스처와 같은 틱에 콜아웃이 와도 목소리가 나간다', async () => {
    const voice = createHandVoice()
    await settlePreload()

    document.dispatchEvent(new Event('pointerdown'))
    voice.play('yacht')

    expect(audio.started).toEqual(['yacht.wav'])
    voice.dispose()
  })

  it('dispose 뒤에는 제스처가 잠금을 풀지 않는다', async () => {
    const voice = createHandVoice()
    await settlePreload()
    voice.dispose()

    document.dispatchEvent(new Event('pointerdown'))

    expect(audio.resumeCount).toBe(0)
  })

  it('재생이 스스로 끝나면 다음 play가 stop을 부르지 않는다', async () => {
    const voice = createHandVoice()
    await settlePreload()

    voice.play('yacht')
    audio.lastSource?.onended?.()
    voice.play('fourOfAKind')

    // 이미 끝난 소스라 stop 목록에 남지 않는다 — 재생 중인 것만 끊는다.
    expect(audio.stopped).toEqual([])
    expect(audio.started).toEqual(['yacht.wav', 'four-of-a-kind.wav'])
    voice.dispose()
  })

  it('Web Audio 생성이 실패하는 환경에서도 조용히 넘어간다', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('Web Audio unavailable')
        }
      },
    )

    expect(() => createHandVoice().play('yacht')).not.toThrow()
  })
})
