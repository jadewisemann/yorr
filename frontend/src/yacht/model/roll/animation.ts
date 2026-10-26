import type { DiceSet } from '@/yacht/domain/dice'

export type RollInputMode = 'motion' | 'tap'
export type RollAnimationMode = RollInputMode | 'remote' | 'auto'

export interface RollSeedInput {
  roomId: string
  playerId: string
  roundNumber: number
  rollCount: number
  dice: DiceSet
}

/**
 * 굴림 하나의 애니메이션 시드. 같은 (방·플레이어·라운드·굴림·주사위)면 언제나 같은
 * 값이 나와야 한다 — 관전자와 굴린 사람이 같은 애니메이션을 보게 하는 계약이다.
 */
export function animationSeedForRoll(input: RollSeedInput) {
  const { roomId, playerId, roundNumber, rollCount, dice } = input
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
