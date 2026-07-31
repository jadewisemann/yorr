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

it('plays the matching hero track for the selected landing game', async () => {
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

  const { playLandingSoundtrack } = await import('./landingSoundtrack')
  playLandingSoundtrack('yacht')

  const yachtTrack = audios.find((audio) => audio.getAttribute('src')?.endsWith('/yacht.mp3'))
  expect(yachtTrack?.play).toHaveBeenCalledOnce()

  vi.unstubAllGlobals()
})

it('retries the requested game track after direct invite autoplay is blocked', async () => {
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

  const { playGameSoundtrack } = await import('./landingSoundtrack')
  playGameSoundtrack()
  document.dispatchEvent(new Event('click'))

  const landing = audios.find((audio) => audio.getAttribute('src')?.endsWith('/yacht.mp3'))
  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))

  expect(landing?.play).not.toHaveBeenCalled()
  expect(game?.play).toHaveBeenCalledTimes(2)

  vi.unstubAllGlobals()
})

it('setSoundtrackMuted pauses or resumes whatever track is currently playing', async () => {
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

  const { playGameSoundtrack, setSoundtrackMuted } = await import('./landingSoundtrack')
  playGameSoundtrack()
  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))

  setSoundtrackMuted(true)
  expect(game?.pause).toHaveBeenCalled()

  setSoundtrackMuted(false)
  expect(game?.play).toHaveBeenCalledTimes(2)

  vi.unstubAllGlobals()
})
