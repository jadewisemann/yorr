export function vibrate(pattern: VibratePattern) {
  if (document.hidden || typeof navigator.vibrate !== 'function') return
  navigator.vibrate(pattern)
}

export const WIN_VIBRATION = [40, 60, 40, 60, 120]
export const LOSE_VIBRATION = 320
