import { expect, it, vi } from 'vitest'

it('효과음을 처음부터 다시 재생한다', async () => {
  vi.resetModules()
  window.localStorage.clear()
  const audio = document.createElement('audio')
  audio.play = vi.fn(() => Promise.resolve())
  vi.stubGlobal(
    'Audio',
    vi.fn(function AudioMock() {
      return audio
    }),
  )

  const { createSoundEffect } = await import('../soundEffect')
  const play = createSoundEffect('/effect.mp3')
  audio.currentTime = 1
  play()

  expect(audio.currentTime).toBe(0)
  expect(audio.play).toHaveBeenCalledOnce()
  vi.unstubAllGlobals()
})
