import { effectsLevel } from '@/shared/audio/audioLevels'
import { onFirstGesture, primeAudio } from '@/shared/audio/audioUnlock'
import type { PhysicsDiceIndex, PhysicsDicePhase } from '@/yacht/rendering/physics-dice/types'

const SHAKE_RATE_LIMIT_MS = 80
/**
 * 흔들기 펄스가 이만큼 끊기면 사발 소리를 멈춘다 — 손을 멈추면 사발 안 주사위도 멈추므로
 * 소리만 계속 나면 화면과 어긋난다. 펄스는 방향이 바뀔 때마다 오므로(보통 150ms 안쪽)
 * 흔드는 중에 이 간격이 비는 일은 없다. 버튼으로 굴리면 펄스가 아예 없고, 그때는 사발이
 * 정해진 애니메이션으로 계속 흔들리므로 이 타이머를 걸지 않는다.
 */
const SHAKE_IDLE_STOP_MS = 240

/**
 * 굴림 소리는 3단계다: 사발 안에서 흔드는 동안 shake를 돌리고, 사발을 엎는 순간(pouring)
 * pour를 한 번 내고, 주사위가 바닥에 부딪힐 때마다 hits가 난다.
 *
 * 요소를 게임 화면 진입이 아니라 **앱이 뜰 때** 만드는 이유: iOS는 `<audio>` 요소마다
 * "사용자 제스처 안에서 재생된 적이 있는가"를 따로 기억한다. 관전자는 게임 화면을 한 번도
 * 만지지 않는다 — 호스트가 시작을 누르고, 남이 굴리는 것을 볼 뿐이다. 요소가 그 화면에서
 * 만들어지면 첫 탭 전까지 잠겨 있어서 방장의 1라운드 굴림 소리가 통째로 빠졌다.
 * 앱 시작에 만들어 두면 닉네임·초대 화면에서 누른 첫 탭이 이것들까지 같이 풀어준다.
 */
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

/** 서로 다르게 맞춰 둔 기본 믹스. 슬라이더는 여기에 배율을 곱한다(shared/audio/audioLevels). */
const SHAKE_BASE_VOLUME = 0.5
const POUR_BASE_VOLUME = 0.7

onFirstGesture(() => primeAudio([shake, pour, ...hits]))

export function createRollFeedback({ muted = false }: { muted?: boolean } = {}) {
  let lastShakeAt = 0
  let phase: PhysicsDicePhase = 'idle'
  let isMuted = muted
  let shakeIdleTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 배율은 **재생 시점에** 읽는다. 모듈 로드 때 한 번 곱해 두면 설정을 바꿔도 이번 세션 내내
   * 옛 볼륨으로 난다. 이미 나고 있는 소리는 그대로 두고 다음 소리부터 반영된다 —
   * 짧은 효과음이라 눈치채지 못한다(배경음은 계속 흐르므로 soundtrack이 즉시 반영한다).
   */
  const play = (audio: HTMLAudioElement, baseVolume: number) => {
    audio.volume = baseVolume * effectsLevel()
    void audio.play().catch(() => undefined)
  }

  const clearShakeIdle = () => {
    if (shakeIdleTimer === null) return
    clearTimeout(shakeIdleTimer)
    shakeIdleTimer = null
  }

  /**
   * 사발이 움직이는 동안만 소리가 나게 한다. 펄스가 올 때마다 정지 예약을 미루고, 멈춰서
   * 예약이 터지면 소리도 멈춘다 — 내가 흔들든 남이 흔들든 화면 속 사발과 같이 간다.
   */
  const keepShakeSounding = () => {
    if (phase !== 'shaking' || isMuted) return
    if (shake.paused) play(shake, SHAKE_BASE_VOLUME)
    clearShakeIdle()
    shakeIdleTimer = setTimeout(() => {
      shakeIdleTimer = null
      shake.pause()
    }, SHAKE_IDLE_STOP_MS)
  }

  const vibrate = (pattern: VibratePattern) => {
    if (document.hidden || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(pattern)
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
      // 세기에 따라 base가 매번 다르다 — play가 여기에 배율을 곱한다.
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
      // 엎는 소리는 한 번만 — 사발이 기울기 시작하는 이 순간이고, 이어서 주사위가
      // 바닥에 닿으며 hits가 난다.
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
