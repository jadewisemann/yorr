import { effectsLevel } from './audioLevels'
import { onFirstGesture, primeAudio } from './audioUnlock'
import { setElementVolume } from './elementVolume'
import { readSoundMuted } from './soundPreference'

export function createSoundEffect(source: string, baseVolume = 0.7) {
  const audio = new Audio(source)
  audio.preload = 'auto'
  onFirstGesture(() => primeAudio([audio]))

  return () => {
    if (readSoundMuted()) return
    audio.currentTime = 0
    setElementVolume(audio, baseVolume * effectsLevel())
    void audio.play().catch(() => undefined)
  }
}
