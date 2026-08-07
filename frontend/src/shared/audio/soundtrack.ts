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
  return [...tracks.values(), ...gameTracks.values(), resultTrack].filter((track) => track !== null)
}

function prepare(): void {
  if (tracks.size) return

  for (const { key } of games) {
    const audio = new Audio(`/audio/landing/${key}.mp3`)
    audio.loop = true
    audio.preload = 'auto'
    tracks.set(key, audio)
  }
  for (const [code, source] of Object.entries({
    DUEL: '/audio/game/duel-ingame.mp3',
    PING_PONG: '/audio/game/ping-pong-ingame.mp3',
    YACHT_DICE: '/audio/game/yacht_ingame.mp3',
  }) as [GameCode, string][]) {
    const audio = new Audio(source)
    audio.loop = true
    audio.preload = 'auto'
    gameTracks.set(code, audio)
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
