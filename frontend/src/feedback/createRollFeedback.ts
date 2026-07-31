import type { PhysicsDicePhase } from '@/rendering/physics-dice/types'
import type { RollFeedback } from './RollFeedback'

const SHAKE_RATE_LIMIT_MS = 80

export function createRollFeedback({ muted = false }: { muted?: boolean } = {}): RollFeedback {
  let lastShakeAt = 0
  let phase: PhysicsDicePhase = 'idle'
  let isMuted = muted
  const bowl = new Audio('/audio/game/bowl-shake.mp3')
  const hits = Array.from({ length: 5 }, (_, index) => {
    const audio = new Audio('/audio/game/dice-hit.mp3')
    audio.preload = 'auto'
    audio.playbackRate = 0.94 + index * 0.03
    return audio
  })
  bowl.loop = true
  bowl.preload = 'auto'
  bowl.volume = 0.5

  const vibrate = (pattern: VibratePattern) => {
    if (document.hidden || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(pattern)
  }

  return {
    armed() {
      vibrate(24)
    },
    diceImpact(index, strength) {
      if (isMuted) return
      const audio = hits[index]
      if (!audio) return
      audio.currentTime = 0
      audio.volume = 0.15 + Math.min(1, strength) * 0.65
      void audio.play().catch(() => undefined)
    },
    dispose() {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(0)
      bowl.pause()
      for (const audio of hits) audio.pause()
    },
    error() {
      vibrate([35, 30, 35])
    },
    phaseChanged(next) {
      phase = next
      if (next === 'shaking' && !isMuted) {
        void bowl.play().catch(() => undefined)
      } else {
        bowl.pause()
        bowl.currentTime = 0
      }
    },
    setMuted(next) {
      isMuted = next
      if (next) {
        bowl.pause()
        for (const audio of hits) audio.pause()
      } else if (phase === 'shaking') {
        void bowl.play().catch(() => undefined)
      }
    },
    shakePulse(_direction, strength) {
      const now = performance.now()
      if (now - lastShakeAt < SHAKE_RATE_LIMIT_MS) return
      lastShakeAt = now
      vibrate(Math.round(10 + Math.min(1, strength) * 8))
    },
    thrown() {
      vibrate([20, 20, 45])
    },
  }
}
