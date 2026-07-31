import { expect, it, vi } from 'vitest'
import { createRollFeedback } from './createRollFeedback'

it('loops the bowl while shaking and plays each die impact independently', () => {
  const audios: HTMLAudioElement[] = []
  vi.stubGlobal(
    'Audio',
    vi.fn(function AudioMock(src?: string) {
      const audio = document.createElement('audio')
      if (src) audio.setAttribute('src', src)
      audio.play = vi.fn(() => Promise.resolve())
      audio.pause = vi.fn()
      audios.push(audio)
      return audio
    }),
  )

  const feedback = createRollFeedback()
  const bowl = audios[0]
  const secondDie = audios[2]

  feedback.phaseChanged('shaking')
  expect(bowl?.loop).toBe(true)
  expect(bowl?.play).toHaveBeenCalledOnce()

  feedback.diceImpact(1, 0.5)
  expect(secondDie?.play).toHaveBeenCalledOnce()
  expect(secondDie?.volume).toBeCloseTo(0.475)

  feedback.phaseChanged('pouring')
  expect(bowl?.pause).toHaveBeenCalledOnce()

  vi.unstubAllGlobals()
})
