import { effectsLevel } from '@/shared/audio/audioLevels'
import { onFirstGesture, primeAudio } from '@/shared/audio/audioUnlock'
import { setElementVolume } from '@/shared/audio/elementVolume'
import { vibrate } from '@/shared/vibrate'
import type { PhysicsDiceIndex, PhysicsDicePhase } from '@/yacht/rendering/physics-dice/types'

const SHAKE_RATE_LIMIT_MS = 80
const SHAKE_IDLE_STOP_MS = 240

const shake = new Audio('/audio/game/bowl-shake.wav')
const pour = new Audio('/audio/game/bowl-pour.wav')
const hits = Array.from({ length: 5 }, (_, index) => {
  const audio = new Audio('/audio/game/dice-hit.mp3')
  audio.preload = 'auto'
  audio.playbackRate = 0.94 + index * 0.03
  return audio
})
shake.loop = true
shake.preload = 'auto'
pour.preload = 'auto'

const SHAKE_BASE_VOLUME = 0.5
const POUR_BASE_VOLUME = 0.7

onFirstGesture(() => primeAudio([shake, pour, ...hits]))

export function createRollFeedback({ muted = false }: { muted?: boolean } = {}) {
  let lastShakeAt = 0
  let phase: PhysicsDicePhase = 'idle'
  let isMuted = muted
  let shakeIdleTimer: ReturnType<typeof setTimeout> | null = null

  const play = (audio: HTMLAudioElement, baseVolume: number) => {
    setElementVolume(audio, baseVolume * effectsLevel())
    void audio.play().catch(() => undefined)
  }

  const clearShakeIdle = () => {
    if (shakeIdleTimer === null) return
    clearTimeout(shakeIdleTimer)
    shakeIdleTimer = null
  }

  const keepShakeSounding = () => {
    if (phase !== 'shaking' || isMuted) return
    if (shake.paused) play(shake, SHAKE_BASE_VOLUME)
    clearShakeIdle()
    shakeIdleTimer = setTimeout(() => {
      shakeIdleTimer = null
      shake.pause()
    }, SHAKE_IDLE_STOP_MS)
  }

  return {
    armed() {
      vibrate(24)
    },
    diceImpact(index: PhysicsDiceIndex, strength: number) {
      if (isMuted) return
      const audio = hits[index]
      if (!audio) return
      audio.currentTime = 0
      play(audio, 0.15 + Math.min(1, strength) * 0.65)
    },
    dispose() {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(0)
      clearShakeIdle()
      shake.pause()
      pour.pause()
      for (const audio of hits) audio.pause()
    },
    error() {
      vibrate([35, 30, 35])
    },
    phaseChanged(next: PhysicsDicePhase) {
      phase = next
      clearShakeIdle()
      if (next === 'shaking') {
        if (!isMuted) play(shake, SHAKE_BASE_VOLUME)
        return
      }
      shake.pause()
      shake.currentTime = 0
      if (next === 'pouring' && !isMuted) {
        pour.currentTime = 0
        play(pour, POUR_BASE_VOLUME)
      }
    },
    setMuted(next: boolean) {
      isMuted = next
      if (next) {
        shake.pause()
        pour.pause()
        for (const audio of hits) audio.pause()
      } else if (phase === 'shaking') {
        play(shake, SHAKE_BASE_VOLUME)
      }
    },
    remoteShakePulse() {
      keepShakeSounding()
    },
    shakePulse(_direction: 'left' | 'right', strength: number) {
      keepShakeSounding()

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
