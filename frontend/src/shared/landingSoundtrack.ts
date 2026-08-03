import { type HeroGameKey, landingGames } from '@/landingGames'
import { onFirstGesture, primeAudio } from './audioUnlock'
import { readSoundMuted } from './soundPreference'

let soundtrack: HTMLAudioElement | null = null
let gameTrack: HTMLAudioElement | null = null
let resultTrack: HTMLAudioElement | null = null
let stopWaitingForGesture: (() => void) | null = null
const tracks = new Map<HeroGameKey, HTMLAudioElement>()

/** 화면이 바뀔 때마다 갈아탈 수 있는 트랙 전부. 잠금은 요소마다 따로라 한꺼번에 풀어둔다. */
function allTracks(): HTMLAudioElement[] {
  return [...tracks.values(), gameTrack, resultTrack].filter((track) => track !== null)
}

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

  waitForGesture()
}

/**
 * 첫 조작에서 모든 트랙의 잠금을 풀고, 지금 틀어야 할 트랙을 재생한다.
 *
 * 트랙 하나가 아니라 전부를 푸는 게 핵심이다 — iOS는 요소마다 잠금을 따로 기억해서,
 * 랜딩 BGM만 풀어두면 게임 화면으로 넘어가며 갈아탄 yacht_ingame이 조용하다(그 전환에는
 * 제스처가 없다). 재생이 거절되면 리스너를 다시 걸어 다음 조작에서 만회한다.
 */
function waitForGesture(): void {
  if (stopWaitingForGesture) return
  stopWaitingForGesture = onFirstGesture(() => {
    stopWaitingForGesture = null
    // 지금 틀 트랙은 바로 아래에서 제대로 재생하므로 잠금 해제 대상에서 뺀다.
    primeAudio(allTracks().filter((track) => track !== soundtrack))
    if (readSoundMuted()) return
    void soundtrack?.play().catch(() => waitForGesture())
  })
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
  // 거절 = 아직 이 요소가 잠겨 있다(화면 전환처럼 제스처 없이 갈아탄 경우). 다음 조작을 노린다.
  void soundtrack.play().catch(() => waitForGesture())
}

export function setSoundtrackMuted(muted: boolean): void {
  if (muted) soundtrack?.pause()
  else void soundtrack?.play().catch(() => waitForGesture())
}
