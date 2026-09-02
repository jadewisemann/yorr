import { expect, it } from 'vitest'
import { saveSoundMuted } from '@/shared/audio/soundPreference'
import { installAudioRecorder } from './audioRecorder'

const YACHT_HERO = '/yacht.mp3'
const YACHT_GAME = 'yacht_ingame.mp3'

const track = installAudioRecorder()

it('음소거 상태에서는 어떤 트랙도 재생하지 않는다', async () => {
  saveSoundMuted(true)

  const { playLandingSoundtrack } = await import('@/shared/audio/soundtrack')
  playLandingSoundtrack('yacht')

  expect(track(YACHT_HERO)?.play).not.toHaveBeenCalled()
})

it('첫 조작에서 나중에 갈아탈 트랙까지 잠금을 풀어 둔다', async () => {
  const { playLandingSoundtrack, playGameSoundtrack } = await import('@/shared/audio/soundtrack')
  playLandingSoundtrack('yacht')
  document.dispatchEvent(new Event('pointerdown'))

  // 잠금 해제는 한 번 재생했다 멈추는 것으로 이뤄진다 — 그래서 아직 들리지 않는다.
  expect(track(YACHT_GAME)?.play).toHaveBeenCalledOnce()
  expect(track(YACHT_GAME)?.pause).toHaveBeenCalledOnce()

  playGameSoundtrack()
  expect(track(YACHT_GAME)?.play).toHaveBeenCalledTimes(2)
})

it('결과 트랙을 틀기 전에 인게임 트랙을 멈춘다', async () => {
  const { playGameSoundtrack, playResultSoundtrack } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack()
  playResultSoundtrack()

  expect(track(YACHT_GAME)?.pause).toHaveBeenCalledOnce()
  expect(track('/result.mp3')?.play).toHaveBeenCalledOnce()
  // 결과 트랙은 한 번만 흐른다.
  expect(track('/result.mp3')?.loop).toBe(false)
})

it('게임에 맞는 인게임 BGM을 재생한다', async () => {
  const { playGameSoundtrack } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack('PING_PONG')

  expect(track('/ping-pong-ingame.mp3')?.play).toHaveBeenCalledOnce()
})

it('고른 게임에 맞는 랜딩 트랙을 재생한다', async () => {
  const { playLandingSoundtrack } = await import('@/shared/audio/soundtrack')
  playLandingSoundtrack('yacht')

  expect(track(YACHT_HERO)?.play).toHaveBeenCalledOnce()
})

it('초대 링크로 바로 들어와 자동 재생이 막히면 첫 조작에서 다시 시도한다', async () => {
  const { playGameSoundtrack } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack()
  document.dispatchEvent(new Event('pointerdown'))

  expect(track(YACHT_HERO)?.pause).toHaveBeenCalledOnce()
  expect(track(YACHT_GAME)?.play).toHaveBeenCalledTimes(2)
})

it('음소거를 켜고 끄면 지금 흐르던 트랙이 멈췄다 이어진다', async () => {
  const { playGameSoundtrack, setSoundtrackMuted } = await import('@/shared/audio/soundtrack')
  playGameSoundtrack()

  setSoundtrackMuted(true)
  expect(track(YACHT_GAME)?.pause).toHaveBeenCalled()

  setSoundtrackMuted(false)
  expect(track(YACHT_GAME)?.play).toHaveBeenCalledTimes(2)
})
