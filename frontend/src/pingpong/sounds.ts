import type { PingPongEventType } from '@/realtime/wsEvents'
import { createSoundEffect } from '@/shared/audio/soundEffect'

const playRacket = createSoundEffect('/audio/game/ping-pong-racket-hit.mp3', 0.7)
export const playTableHit = createSoundEffect('/audio/game/ping-pong-table-hit.mp3', 0.65)

const RACKET_EVENTS = new Set<PingPongEventType>([
  'PRACTICE',
  'SERVE',
  'OK',
  'NICE',
  'SMASH',
  'OUT',
  'NET',
])

export function playRacketHit(type: PingPongEventType) {
  if (RACKET_EVENTS.has(type)) playRacket()
}
