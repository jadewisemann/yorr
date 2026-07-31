import type { HeroGameKey } from './landingGames'
import { readSoundMuted } from './soundPreference'

let soundtrack: HTMLAudioElement | null = null

export function playLandingSoundtrack(game: HeroGameKey): void {
  if (readSoundMuted()) return

  soundtrack ??= new Audio()
  soundtrack.loop = true
  soundtrack.volume = 0.35

  const src = `/audio/landing/${game}.mp3`
  if (soundtrack.getAttribute('src') !== src) {
    soundtrack.src = src
    soundtrack.currentTime = 0
  }
  void soundtrack.play().catch(() => undefined)
}

export function stopLandingSoundtrack(): void {
  soundtrack?.pause()
  if (soundtrack) soundtrack.currentTime = 0
}
