import type { DiceSet } from './dice'
import { scoreCategory } from './scoring'

/** 굴림 직후 연출 대상이 되는 하단 족보. 높은 것이 앞이다. */
export const SPECIAL_HANDS_BY_RANK = [
  'yacht',
  'largeStraight',
  'smallStraight',
  'fullHouse',
  'fourOfAKind',
] as const

export type SpecialHand = (typeof SPECIAL_HANDS_BY_RANK)[number]

/**
 * 지금 주사위(킵 포함 5개)가 성립시키는 가장 높은 족보.
 * Choice·상단 족보는 항상 성립하므로 연출 대상에서 뺀다 — 매 굴림이 시끄러워진다.
 */
export function detectSpecialHand(dice: DiceSet): SpecialHand | null {
  return SPECIAL_HANDS_BY_RANK.find((hand) => scoreCategory(dice, hand) > 0) ?? null
}
