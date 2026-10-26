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
const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const

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

/** 오디오 그래프 — 컨텍스트와 볼륨 노드. 브라우저가 막으면 조용히 null이 된다. */
interface AudioGraph {
  context: AudioContext
  master: GainNode
}

function openAudioGraph(): AudioGraph | null {
  const Constructor = resolveAudioContext()
  if (!Constructor) return null
  try {
    const context = new Constructor()
    const master = context.createGain()
    master.gain.value = VOICE_VOLUME
    master.connect(context.destination)
    return { context, master }
  } catch {
    return null
  }
}

/** 특수 족보 음성 재생기. 파일은 처음 만들 때 미리 받아 둔다. */
export function createHandVoice({ muted = false }: { muted?: boolean } = {}): HandVoice {
  let isMuted = muted
  let disposed = false
  let graph = openAudioGraph()
  let playing: AudioBufferSourceNode | null = null
  const buffers = new Map<SpecialHand, AudioBuffer>()

  if (graph) void preload(graph.context, buffers, () => disposed)

  const unlock = () => {
    if (graph?.context.state === 'suspended') void graph.context.resume().catch(() => undefined)
  }
  for (const type of GESTURE_EVENTS) {
    document.addEventListener(type, unlock, { passive: true })
  }

  const stop = () => {
    if (!playing) return
    playing.onended = null
    try {
      playing.stop()
    } catch {}
    playing = null
  }

  const play = (hand: SpecialHand) => {
    const current = graph
    if (isMuted || !current) return
    const buffer = buffers.get(hand)
    if (!buffer) return
    stop()
    current.master.gain.value = VOICE_VOLUME * effectsLevel()
    const source = startSource(current, buffer, {
      isCurrent: () => playing === source,
      onEnded: () => {
        if (playing === source) playing = null
      },
    })
    playing = source
  }

  return {
    dispose() {
      disposed = true
      for (const type of GESTURE_EVENTS) document.removeEventListener(type, unlock)
      stop()
      buffers.clear()
      void graph?.context.close().catch(() => undefined)
      graph = null
    },
    play,
    setMuted(next) {
      isMuted = next
      if (next) stop()
    },
  }
}

async function preload(
  context: AudioContext,
  buffers: Map<SpecialHand, AudioBuffer>,
  isDisposed: () => boolean,
) {
  await Promise.all(
    SPECIAL_HANDS_BY_RANK.map(async (hand) => {
      try {
        const response = await fetch(HAND_VOICE_SOURCE[hand])
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        if (!isDisposed()) buffers.set(hand, buffer)
      } catch {}
    }),
  )
}

/**
 * 재생 시작. 컨텍스트가 잠들어 있으면(자동재생 정책) 깨운 뒤 시작한다 —
 * 깨우는 사이에 다른 음성이 끼어들었으면 시작하지 않는다.
 */
function startSource(
  graph: AudioGraph,
  buffer: AudioBuffer,
  handlers: { isCurrent: () => boolean; onEnded: () => void },
): AudioBufferSourceNode {
  const source = graph.context.createBufferSource()
  source.buffer = buffer
  source.connect(graph.master)
  source.onended = handlers.onEnded
  if (graph.context.state === 'running') {
    source.start()
    return source
  }
  void graph.context
    .resume()
    .then(() => {
      if (handlers.isCurrent()) source.start()
    })
    .catch(() => undefined)
  return source
}
