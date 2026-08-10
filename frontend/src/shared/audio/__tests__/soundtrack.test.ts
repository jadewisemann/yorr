import { expect, it, vi } from 'vitest'
import { saveSoundMuted } from '@/shared/audio/soundPreference'

it('음소거 상태에서는 어떤 트랙도 재생하지 않는다', async () => {
  vi.resetModules()
  window.localStorage.clear()
  saveSoundMuted(true)
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

  const { playLandingSoundtrack } = await import('@/shared/audio/soundtrack')
  playLandingSoundtrack('yacht')

  const yachtTrack = audios.find((audio) => audio.getAttribute('src')?.endsWith('/yacht.mp3'))
  expect(yachtTrack?.play).not.toHaveBeenCalled()

  window.localStorage.clear()
  vi.unstubAllGlobals()
})

it('첫 조작에서 나중에 갈아탈 트랙까지 잠금을 풀어 둔다', async () => {
  vi.resetModules()
  window.localStorage.clear()
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

  const { playLandingSoundtrack, playGameSoundtrack } = await import('@/shared/audio/soundtrack')
  playLandingSoundtrack('yacht')
  document.dispatchEvent(new Event('pointerdown'))

  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))
  expect(game?.play).toHaveBeenCalledOnce()
  expect(game?.pause).toHaveBeenCalledOnce()

  playGameSoundtrack()
  expect(game?.play).toHaveBeenCalledTimes(2)

  vi.unstubAllGlobals()
})

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

  const { playGameSoundtrack, playResultSoundtrack } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack()
  playResultSoundtrack()

  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))
  const result = audios.find((audio) => audio.getAttribute('src')?.endsWith('/result.mp3'))

  expect(game?.pause).toHaveBeenCalledOnce()
  expect(result?.play).toHaveBeenCalledOnce()
  expect(result?.loop).toBe(false)

  vi.unstubAllGlobals()
})

it('게임에 맞는 인게임 BGM을 재생한다', async () => {
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

  const { playGameSoundtrack } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack('PING_PONG')

  const pingPong = audios.find((audio) =>
    audio.getAttribute('src')?.endsWith('/ping-pong-ingame.mp3'),
  )
  expect(pingPong?.play).toHaveBeenCalledOnce()

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

  const { playLandingSoundtrack } = await import('@/shared/audio/soundtrack')
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

  const { playGameSoundtrack } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack()
  document.dispatchEvent(new Event('pointerdown'))

  const landing = audios.find((audio) => audio.getAttribute('src')?.endsWith('/yacht.mp3'))
  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))

  expect(landing?.pause).toHaveBeenCalledOnce()
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

  const { playGameSoundtrack, setSoundtrackMuted } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack()
  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))

  setSoundtrackMuted(true)
  expect(game?.pause).toHaveBeenCalled()

  setSoundtrackMuted(false)
  expect(game?.play).toHaveBeenCalledTimes(2)

  vi.unstubAllGlobals()
})
