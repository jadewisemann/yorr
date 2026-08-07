import { type HeldDice, nextRollSeed, rollDice } from '@/yacht/domain/dice'
import { leverageMultiplier, pickLeverageCategory } from '@/yacht/domain/leverage'
import { scoreCategory, YACHT_CATEGORIES } from '@/yacht/domain/scoring'
import { createLocalSession, createLocalSnapshot, createLocalYachtClient } from './localGame'

export const LEVERAGE_ROOM_ID = 'leverage'
export const LEVERAGE_PLAYER_ID = 'leverage-player'
export const LEVERAGE_ROUNDS = YACHT_CATEGORIES.length

export const leverageSession = createLocalSession({
  playerId: LEVERAGE_PLAYER_ID,
  roomCode: 'LEVERAGE',
  roomId: LEVERAGE_ROOM_ID,
})

export function createLeverageSnapshot() {
  return createLocalSnapshot({ playerId: LEVERAGE_PLAYER_ID, roomId: LEVERAGE_ROOM_ID })
}

export function createLeverageClient(seed: number) {
  let rollSeed = seed

  return createLocalYachtClient({
    playerId: LEVERAGE_PLAYER_ID,
    roomId: LEVERAGE_ROOM_ID,
    rounds: LEVERAGE_ROUNDS,
    roll: ({ held, previous }) => {
      rollSeed = nextRollSeed(rollSeed)
      return rollDice(rollSeed, held as HeldDice, previous)
    },
    score: ({ category, dice, roundNumber, used }) =>
      scoreCategory(dice, category) *
      leverageMultiplier(category, pickLeverageCategory(seed, roundNumber, used)),
  })
}
