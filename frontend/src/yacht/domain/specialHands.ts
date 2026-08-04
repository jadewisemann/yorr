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
 * 지금 주사위(킵 포함 5개)가 성립시키는 가장 높은 <b>아직 쓸 수 있는</b> 족보.
 * Choice·상단 족보는 항상 성립하므로 연출 대상에서 뺀다 — 매 굴림이 시끄러워진다.
 *
 * 이미 채운 칸은 `recorded`로 걸러 <b>다음 순위로 내려간다</b>. 걸러내지 않고 호출자가
 * "고른 족보가 채워져 있으면 연출 안 함"으로 처리하면, 라지 스트레이트를 채운 뒤 또 라지가
 * 나올 때 연출이 통째로 사라진다 — 스몰로 아직 쓸 수 있는데도(S15P11A406-182).
 */
export function detectSpecialHand(
  dice: DiceSet,
  recorded: (hand: SpecialHand) => boolean = () => false,
): SpecialHand | null {
  return (
    SPECIAL_HANDS_BY_RANK.find((hand) => !recorded(hand) && scoreCategory(dice, hand) > 0) ?? null
  )
}
