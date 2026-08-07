import type { DiceSet } from '@/yacht/domain/dice'

export type RollInputMode = 'motion' | 'tap'
export type RollAnimationMode = RollInputMode | 'remote' | 'auto'

export function animationSeedForRoll(
  roomId: string,
  playerId: string,
  roundNumber: number,
  rollCount: number,
  dice: DiceSet,
) {
  const key = `${roomId}:${playerId}:${roundNumber}:${rollCount}:${dice.join('')}`
  let hash = 2_166_136_261
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16_777_619)
  }
  return hash >>> 0
}

export function rollAnimationMode({
  forced,
  ownRoll,
  pendingInputMode,
}: {
  forced: boolean
  ownRoll: boolean
  pendingInputMode: RollInputMode | null
}): RollAnimationMode {
  if (forced) return 'auto'
  if (pendingInputMode) return pendingInputMode
  return ownRoll ? 'tap' : 'remote'
}
