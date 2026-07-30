import { SPECIAL_HANDS_BY_RANK, type SpecialHand } from '@/domain/specialHands'

/**
 * `public/audio/hand-voice/`의 콜아웃 음성. 화면에 뜨는 족보 텍스트와 같은 말을 읽는다.
 * 직접 녹음한 파일을 `scripts/voice-source/`에 넣고 `scripts/import-hand-voice.mjs`를
 * 돌리면 이 경로에 만들어진다 — 목소리를 바꿔도 코드는 그대로다.
 * 파일이 없거나 재생이 막히면 조용히 넘어가고 콜아웃 텍스트만 남는다.
 */
export const HAND_VOICE_SOURCE: Record<SpecialHand, string> = {
  fourOfAKind: '/audio/hand-voice/four-of-a-kind.wav',
  fullHouse: '/audio/hand-voice/full-house.wav',
  largeStraight: '/audio/hand-voice/large-straight.wav',
  smallStraight: '/audio/hand-voice/small-straight.wav',
  yacht: '/audio/hand-voice/yacht.wav',
}

/** 주사위 굴림 소리 위에 얹히는 외침이라 조금 낮춘다. 1.0은 좁은 스피커에서 갈라진다. */
const VOICE_VOLUME = 0.9

export interface HandVoice {
  dispose(): void
  /** 족보 콜아웃이 화면에 뜨는 시점에 호출한다. 음소거·미지원이면 조용히 넘어간다. */
  play(hand: SpecialHand): void
  setMuted(muted: boolean): void
}

type AudioContextConstructor = typeof AudioContext

function resolveAudioContext(): AudioContextConstructor | null {
  const scope = window as typeof window & { webkitAudioContext?: AudioContextConstructor }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

/**
 * 족보 콜아웃 음성 재생기(S15P11A406-138).
 *
 * `<audio>` 요소가 아니라 **Web Audio**로 재생한다. iOS Safari의 `<audio>`는 play()마다
 * 플랫폼 미디어 파이프라인을 다시 세우고 seek 완료를 기다려서, 실기기에서 콜아웃 텍스트보다
 * 목소리가 0.6~0.8초 늦게 나왔다(맥 Chrome에서는 안 보이는 증상). 미리 디코딩해 둔
 * AudioBuffer를 start()로 트리거하면 그 지연이 사라진다.
 *
 * 굴림이 끝나는 시점은 사용자가 화면을 탭한 뒤 1초 이상 지난 뒤고, 흔들어 굴리면 탭이 아예 없다.
 * 두 경우 모두 자동재생 정책에 걸리므로, AudioContext는 만들어만 두고(suspended) 첫 제스처에서
 * resume한다. 잠금을 풀지 못해도 게임은 그대로 진행된다 — 목소리는 콜아웃 텍스트를 보조하는
 * 연출이고, 실패는 조용히 넘긴다.
 */
export function createHandVoice({ muted = false }: { muted?: boolean } = {}): HandVoice {
  let isMuted = muted
  let disposed = false
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let playing: AudioBufferSourceNode | null = null
  const buffers = new Map<SpecialHand, AudioBuffer>()

  const Constructor = resolveAudioContext()
  if (Constructor) {
    try {
      // 제스처 없이도 만들 수 있다(suspended 상태로 시작). 디코딩은 이 상태에서도 된다.
      context = new Constructor()
      master = context.createGain()
      master.gain.value = VOICE_VOLUME
      master.connect(context.destination)
    } catch {
      // Web Audio를 못 쓰는 환경. play()가 조용히 넘어간다.
      context = null
    }
  }

  /** 다섯 음성을 미리 받아 디코딩한다. 굴림이 착지할 때 남은 일은 start() 하나뿐이어야 한다. */
  const preload = async (target: AudioContext) => {
    await Promise.all(
      SPECIAL_HANDS_BY_RANK.map(async (hand) => {
        try {
          const response = await fetch(HAND_VOICE_SOURCE[hand])
          const buffer = await target.decodeAudioData(await response.arrayBuffer())
          // dispose가 먼저 왔으면 이미 닫힌 context의 버퍼다.
          if (!disposed) buffers.set(hand, buffer)
        } catch {
          // 파일이 없거나 디코딩 실패. 그 족보만 조용히 텍스트로 넘어간다.
        }
      }),
    )
  }
  if (context) void preload(context)

  /** 첫 사용자 제스처 안에서만 의미가 있다. 여기서 벗어나면 브라우저가 재생을 거부한다. */
  const unlock = () => {
    if (context?.state === 'suspended') void context.resume().catch(() => undefined)
  }

  const stop = () => {
    if (!playing) return
    playing.onended = null
    try {
      playing.stop()
    } catch {
      // 이미 끝난 소스에 stop()을 부르면 던지는 브라우저가 있다.
    }
    playing = null
  }

  const gestureEvents = ['pointerdown', 'keydown'] as const
  for (const type of gestureEvents) {
    document.addEventListener(type, unlock, { once: true, passive: true })
  }

  return {
    dispose() {
      disposed = true
      for (const type of gestureEvents) document.removeEventListener(type, unlock)
      stop()
      buffers.clear()
      void context?.close().catch(() => undefined)
      context = null
      master = null
    },
    play(hand) {
      if (isMuted || !context || !master) return
      const buffer = buffers.get(hand)
      // 아직 디코딩이 안 끝났으면 이번 콜아웃은 텍스트만 나간다. 억지로 기다리면
      // 콜아웃이 사라진 뒤에 소리가 나서 더 어색하다.
      if (!buffer) return
      // 흔들어 굴리면 착지 시점에 제스처가 없다 — suspended면 여기서 한 번 더 시도한다.
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
      // 앞 콜아웃이 아직 말하는 중이면 끊는다 — 두 목소리가 겹치면 둘 다 안 들린다.
      stop()
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(master)
      source.onended = () => {
        if (playing === source) playing = null
      }
      source.start()
      playing = source
    },
    setMuted(next) {
      isMuted = next
      if (next) stop()
    },
  }
}
