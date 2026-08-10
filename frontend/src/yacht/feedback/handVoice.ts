import { effectsLevel } from '@/shared/audio/audioLevels'
import { SPECIAL_HANDS_BY_RANK, type SpecialHand } from '@/yacht/domain/specialHands'

export const HAND_VOICE_SOURCE: Record<SpecialHand, string> = {
  fourOfAKind: '/audio/hand-voice/four-of-a-kind.wav',
  fullHouse: '/audio/hand-voice/full-house.wav',
  largeStraight: '/audio/hand-voice/large-straight.wav',
  smallStraight: '/audio/hand-voice/small-straight.wav',
  yacht: '/audio/hand-voice/yacht.wav',
}

const VOICE_VOLUME = 0.9

export interface HandVoice {
  dispose(): void
  play(hand: SpecialHand): void
  setMuted(muted: boolean): void
}

type AudioContextConstructor = typeof AudioContext

function resolveAudioContext(): AudioContextConstructor | null {
  const scope = window as typeof window & { webkitAudioContext?: AudioContextConstructor }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

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
      context = new Constructor()
      master = context.createGain()
      master.gain.value = VOICE_VOLUME
      master.connect(context.destination)
    } catch {
      context = null
    }
  }

  const preload = async (target: AudioContext) => {
    await Promise.all(
      SPECIAL_HANDS_BY_RANK.map(async (hand) => {
        try {
          const response = await fetch(HAND_VOICE_SOURCE[hand])
          const buffer = await target.decodeAudioData(await response.arrayBuffer())
          if (!disposed) buffers.set(hand, buffer)
        } catch {}
      }),
    )
  }
  if (context) void preload(context)

  const unlock = () => {
    if (context?.state === 'suspended') void context.resume().catch(() => undefined)
  }

  const stop = () => {
    if (!playing) return
    playing.onended = null
    try {
      playing.stop()
    } catch {}
    playing = null
  }

  const gestureEvents = ['pointerdown', 'touchend', 'keydown'] as const
  for (const type of gestureEvents) {
    document.addEventListener(type, unlock, { passive: true })
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
      master.gain.value = VOICE_VOLUME * effectsLevel()
      const buffer = buffers.get(hand)
      if (!buffer) return
      stop()
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(master)
      source.onended = () => {
        if (playing === source) playing = null
      }
      playing = source

      if (context.state === 'running') {
        source.start()
        return
      }
      void context
        .resume()
        .then(() => {
          if (playing === source) source.start()
        })
        .catch(() => undefined)
    },
    setMuted(next) {
      isMuted = next
      if (next) stop()
    },
  }
}
