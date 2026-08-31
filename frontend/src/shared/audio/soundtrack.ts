import { type GameCode, type GameKey, games } from '@/games'
import { musicLevel } from './audioLevels'
import { onFirstGesture, primeAudio } from './audioUnlock'
import { setElementVolume } from './elementVolume'
import { readSoundMuted } from './soundPreference'

const BASE_MUSIC_VOLUME = 0.35

let soundtrack: HTMLAudioElement | null = null
const gameTracks = new Map<GameCode, HTMLAudioElement>()
let resultTrack: HTMLAudioElement | null = null
let stopWaitingForGesture: (() => void) | null = null
const tracks = new Map<GameKey, HTMLAudioElement>()

function allTracks(): HTMLAudioElement[] {
  // 같은 요소가 두 자리에 걸릴 수 있어 중복을 지운다(아래 `prepare`의 곡 공유).
  // 지우지 않으면 잠금 해제 때 한 요소를 두 번 재생하게 된다.
  return [...new Set([...tracks.values(), ...gameTracks.values(), resultTrack])].filter(
    (track) => track !== null,
  )
}

/**
 * 아직 전용 곡이 없는 게임이 빌려 쓰는 트랙. 없는 파일을 `new Audio`에 넘기면 화면마다
 * 404가 나고 그 게임에서는 음악이 통째로 빠진다 — 결이 가까운 곡으로 이어 둔다.
 * 다빈치 코드는 같은 심리·추리 결인 라이어스 다이스의 곡을 쓰고, 인게임에서는 판을
 * 두고 도는 야추의 곡을 빌린다(위 표).
 */
const LANDING_TRACK: Partial<Record<GameKey, GameKey>> = { davinci: 'liars' }

function prepare(): void {
  if (tracks.size) return

  // **같은 파일에는 요소 하나.** 곡을 나눠 쓰는 게임이 있으므로(위 LANDING_TRACK,
  // 아래 인게임 표) 매번 `new Audio`를 하면 같은 곡의 요소가 둘이 되고, 한쪽을 멈춰도
  // 다른 쪽이 계속 울린다.
  const bySource = new Map<string, HTMLAudioElement>()
  const looping = (source: string): HTMLAudioElement => {
    const existing = bySource.get(source)
    if (existing) return existing
    const audio = new Audio(source)
    audio.loop = true
    audio.preload = 'auto'
    bySource.set(source, audio)
    return audio
  }

  for (const { key } of games) {
    tracks.set(key, looping(`/audio/landing/${LANDING_TRACK[key] ?? key}.mp3`))
  }
  for (const [code, source] of Object.entries({
    DAVINCI_CODE: '/audio/game/yacht_ingame.mp3',
    DUEL: '/audio/game/duel-ingame.mp3',
    PING_PONG: '/audio/game/ping-pong-ingame.mp3',
    YACHT_DICE: '/audio/game/yacht_ingame.mp3',
  }) as [GameCode, string][]) {
    gameTracks.set(code, looping(source))
  }
  resultTrack = new Audio('/audio/game/result.mp3')
  resultTrack.preload = 'auto'
  applyMusicLevel()

  waitForGesture()
}

export function applyMusicLevel(): void {
  const volume = BASE_MUSIC_VOLUME * musicLevel()
  for (const track of allTracks()) setElementVolume(track, volume)
}

function waitForGesture(): void {
  if (stopWaitingForGesture) return
  stopWaitingForGesture = onFirstGesture(() => {
    stopWaitingForGesture = null
    primeAudio(allTracks().filter((track) => track !== soundtrack))
    if (readSoundMuted()) return
    void soundtrack?.play().catch(() => waitForGesture())
  })
}

export function playLandingSoundtrack(game: GameKey): void {
  prepare()
  play(tracks.get(game) ?? null)
}

export function playGameSoundtrack(game: GameCode = 'YACHT_DICE'): void {
  prepare()
  play(gameTracks.get(game) ?? null)
}

export function playResultSoundtrack(): void {
  prepare()
  play(resultTrack)
}

function play(next: HTMLAudioElement | null): void {
  if (!next) return
  if (soundtrack !== next) {
    if (soundtrack) {
      soundtrack.onended = null
      soundtrack.pause()
      soundtrack.currentTime = 0
    }
    next.currentTime = 0
    soundtrack = next
  }
  if (readSoundMuted()) return
  void soundtrack.play().catch(() => waitForGesture())
}

export function setSoundtrackMuted(muted: boolean): void {
  if (muted) soundtrack?.pause()
  else void soundtrack?.play().catch(() => waitForGesture())
}
