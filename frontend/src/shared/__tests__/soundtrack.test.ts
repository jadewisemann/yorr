import { expect, it, vi } from 'vitest'
import { saveSoundMuted } from '@/shared/soundPreference'

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

  const { playLandingSoundtrack } = await import('@/shared/soundtrack')
  playLandingSoundtrack('yacht')

  const yachtTrack = audios.find((audio) => audio.getAttribute('src')?.endsWith('/yacht.mp3'))
  expect(yachtTrack?.play).not.toHaveBeenCalled()

  window.localStorage.clear()
  vi.unstubAllGlobals()
})

/**
 * iOS는 `<audio>` 요소마다 "제스처 안에서 재생된 적이 있는가"를 따로 기억한다. 랜딩에서 탭해
 * 랜딩 BGM만 풀어두면, 게임 시작으로 넘어가며 갈아탄 게임 트랙은 잠긴 채라 조용했다(전환은
 * 코드가 하는 일이라 그 순간 제스처가 없다). 첫 조작에서 갈아탈 트랙까지 전부 풀어둬야 한다.
 */
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

  const { playLandingSoundtrack, playGameSoundtrack } = await import('@/shared/soundtrack')
  playLandingSoundtrack('yacht')
  document.dispatchEvent(new Event('pointerdown'))

  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))
  // 랜딩에서 이미 한 번 재생됐다 멈춘 상태 = 잠금 해제됨.
  expect(game?.play).toHaveBeenCalledOnce()
  expect(game?.pause).toHaveBeenCalledOnce()

  // 게임 화면으로 넘어가는 순간엔 아무도 화면을 만지지 않는다.
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

  const { playGameSoundtrack, playResultSoundtrack } = await import('@/shared/soundtrack')
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

  const { playLandingSoundtrack } = await import('@/shared/soundtrack')
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

  const { playGameSoundtrack } = await import('@/shared/soundtrack')
  playGameSoundtrack()
  // click이 아니라 pointerdown을 듣는다 — 폰에서 쓸어 넘기기만 하면 click은 오지 않는다.
  document.dispatchEvent(new Event('pointerdown'))

  const landing = audios.find((audio) => audio.getAttribute('src')?.endsWith('/yacht.mp3'))
  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))

  // 랜딩 트랙은 잠금만 풀린다(재생 → 즉시 정지). 초대 링크로 바로 들어왔으니 흘러야 하는 건 게임 BGM이다.
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

  const { playGameSoundtrack, setSoundtrackMuted } = await import('@/shared/soundtrack')
  playGameSoundtrack()
  const game = audios.find((audio) => audio.getAttribute('src')?.endsWith('yacht_ingame.mp3'))

  setSoundtrackMuted(true)
  expect(game?.pause).toHaveBeenCalled()

  setSoundtrackMuted(false)
  expect(game?.play).toHaveBeenCalledTimes(2)

  vi.unstubAllGlobals()
})
