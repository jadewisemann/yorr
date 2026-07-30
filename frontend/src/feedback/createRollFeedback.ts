import type { RollFeedback } from './RollFeedback'

const SHAKE_RATE_LIMIT_MS = 80

export function createRollFeedback(): RollFeedback {
  let lastShakeAt = 0

  const vibrate = (pattern: VibratePattern) => {
    if (document.hidden || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(pattern)
  }

  return {
    armed() {
      vibrate(24)
    },
    dispose() {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(0)
    },
    error() {
      vibrate([35, 30, 35])
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
