const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const

export function onFirstGesture(run: () => void): () => void {
  const handler = () => {
    detach()
    run()
  }
  const detach = () => {
    for (const type of GESTURE_EVENTS) document.removeEventListener(type, handler, true)
  }
  for (const type of GESTURE_EVENTS) {
    document.addEventListener(type, handler, { capture: true, passive: true })
  }
  return detach
}

export function primeAudio(elements: Iterable<HTMLAudioElement>): void {
  for (const audio of elements) {
    if (!audio.paused) continue
    void audio.play().catch(() => undefined)
    audio.pause()
    audio.currentTime = 0
  }
}
