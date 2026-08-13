import type { DiceSet } from '@/realtime/wsEvents'
import { createLocalSession, createLocalSnapshot, createLocalYachtClient } from './localGame'

export const TUTORIAL_ROOM_ID = 'tutorial'
export const TUTORIAL_PLAYER_ID = 'tutorial-player'

export const tutorialSession = createLocalSession({
  playerId: TUTORIAL_PLAYER_ID,
  roomCode: 'TUTORIAL',
  roomId: TUTORIAL_ROOM_ID,
})

export function createTutorialSnapshot() {
  return createLocalSnapshot({ playerId: TUTORIAL_PLAYER_ID, roomId: TUTORIAL_ROOM_ID })
}

const SCRIPTED_ROLLS: DiceSet[] = [
  [6, 6, 2, 3, 5],
  [6, 6, 6, 4, 1],
  [6, 6, 6, 6, 2],
]

function scriptedRoll(held: readonly boolean[], previous: DiceSet | null, rollCount: number) {
  const scripted = SCRIPTED_ROLLS[Math.min(rollCount, SCRIPTED_ROLLS.length) - 1]
  if (!scripted) throw new Error(`연습 굴림 ${rollCount}의 대본이 없습니다`)
  return Array.from({ length: 5 }, (_, index) =>
    held[index] && previous ? previous[index] : scripted[index],
  ) as unknown as DiceSet
}

export function createTutorialClient() {
  return createLocalYachtClient({
    playerId: TUTORIAL_PLAYER_ID,
    roomId: TUTORIAL_ROOM_ID,
    roll: ({ held, previous, rollCount }) => scriptedRoll(held, previous, rollCount),
  })
}
