import { type HeroGameKey, landingGames } from './landingGames'
import { readSoundMuted } from './soundPreference'

let soundtrack: HTMLAudioElement | null = null
let gameTrack: HTMLAudioElement | null = null
let resultTrack: HTMLAudioElement | null = null
const tracks = new Map<HeroGameKey, HTMLAudioElement>()

function prepare(): void {
  if (tracks.size) return

  for (const { key } of landingGames) {
    const audio = new Audio(`/audio/landing/${key}.mp3`)
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = 0.35
    tracks.set(key, audio)
  }
  gameTrack = new Audio('/audio/game/yacht_ingame.mp3')
  gameTrack.loop = true
  gameTrack.preload = 'auto'
  gameTrack.volume = 0.35
  resultTrack = new Audio('/audio/game/result.mp3')
  resultTrack.preload = 'auto'
  resultTrack.volume = 0.35

  const unlock = () => {
    document.removeEventListener('click', unlock)
    document.removeEventListener('keydown', unlock)
    if (!readSoundMuted()) void soundtrack?.play().catch(() => undefined)
  }
  document.addEventListener('click', unlock)
  document.addEventListener('keydown', unlock)
}

export function playLandingSoundtrack(game: HeroGameKey): void {
  prepare()
  play(tracks.get(game) ?? null)
}

export function playGameSoundtrack(): void {
  prepare()
  play(gameTrack)
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
  void soundtrack.play().catch(() => undefined)
}

export function setSoundtrackMuted(muted: boolean): void {
  if (muted) soundtrack?.pause()
  else void soundtrack?.play().catch(() => undefined)
}
