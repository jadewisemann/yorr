import { expect, it, vi } from 'vitest'

it('stops the game track before playing the one-shot result track', async () => {
  vi.resetModules()
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

  const { playGameSoundtrack, playResultSoundtrack } = await import('./landingSoundtrack')
  playGameSoundtrack()
  playResultSoundtrack()

  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))
  const result = audios.find((audio) => audio.getAttribute('src')?.endsWith('/result.mp3'))

  expect(game?.pause).toHaveBeenCalledOnce()
  expect(result?.play).toHaveBeenCalledOnce()
  expect(result?.loop).toBe(false)

  vi.unstubAllGlobals()
})
