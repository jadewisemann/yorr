import { expect, it, vi } from 'vitest'
import { onFirstGesture, primeAudio } from '@/shared/audio/audioUnlock'

function fakeAudio(paused = true) {
  const audio = document.createElement('audio')
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused })
  audio.play = vi.fn(() => Promise.resolve())
  audio.pause = vi.fn()
  return audio
}

it('게임 입력 핸들러보다 먼저 오디오 잠금을 해제한다', () => {
  const order: string[] = []
  const button = document.createElement('button')
  document.body.append(button)
  onFirstGesture(() => order.push('unlock'))
  button.addEventListener('pointerdown', () => order.push('input'))

  button.dispatchEvent(new Event('pointerdown', { bubbles: true }))

  expect(order).toEqual(['unlock', 'input'])
  button.remove()
})

it('제스처 안에서 요소를 재생했다 즉시 멈춰 잠금만 푼다', () => {
  const audio = fakeAudio()

  primeAudio([audio])

  // 소리가 새면 안 된다 — play 직후 동기로 멈추고 처음으로 되감는다.
  expect(audio.play).toHaveBeenCalledOnce()
  expect(audio.pause).toHaveBeenCalledOnce()
  expect(audio.currentTime).toBe(0)
})

it('이미 재생 중인 요소는 건드리지 않는다', () => {
  const playing = fakeAudio(false)

  primeAudio([playing])

  // 흐르고 있는 BGM을 잠금 해제한다고 끊으면 안 된다.
  expect(playing.play).not.toHaveBeenCalled()
  expect(playing.pause).not.toHaveBeenCalled()
})

it('첫 제스처에서 한 번만 실행하고, 그만두면 실행하지 않는다', () => {
  const run = vi.fn()
  onFirstGesture(run)

  document.dispatchEvent(new Event('pointerdown'))
  document.dispatchEvent(new Event('touchend'))
  expect(run).toHaveBeenCalledOnce()

  const later = vi.fn()
  const stop = onFirstGesture(later)
  stop()
  document.dispatchEvent(new Event('pointerdown'))
  expect(later).not.toHaveBeenCalled()
})
