let context: AudioContext | null = null
let listeningForGestures = false
const gains = new WeakMap<HTMLAudioElement, GainNode>()

export function setElementVolume(audio: HTMLAudioElement, volume: number): void {
  audio.muted = volume === 0

  const gain = gainFor(audio)
  if (gain) {
    gain.gain.value = volume
    resumeContext()
    return
  }
  audio.volume = volume
}

function gainFor(audio: HTMLAudioElement): GainNode | null {
  const existing = gains.get(audio)
  if (existing) return existing
  try {
    context ??= new AudioContext()
    const gain = context.createGain()
    context.createMediaElementSource(audio).connect(gain).connect(context.destination)
    gains.set(audio, gain)
    listenForGestures()
    return gain
  } catch {
    return null
  }
}

function resumeContext(): void {
  if (context && context.state !== 'running') void context.resume().catch(() => undefined)
}

function listenForGestures(): void {
  if (listeningForGestures) return
  listeningForGestures = true
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(type, resumeContext, { passive: true })
  }
}
