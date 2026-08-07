import type { DiceSet } from './dice'
import { scoreCategory } from './scoring'

export const SPECIAL_HANDS_BY_RANK = [
  'yacht',
  'largeStraight',
  'smallStraight',
  'fullHouse',
  'fourOfAKind',
] as const

export type SpecialHand = (typeof SPECIAL_HANDS_BY_RANK)[number]

export function detectSpecialHand(
  dice: DiceSet,
  recorded: (hand: SpecialHand) => boolean = () => false,
): SpecialHand | null {
  return (
    SPECIAL_HANDS_BY_RANK.find((hand) => !recorded(hand) && scoreCategory(dice, hand) > 0) ?? null
  )
}
