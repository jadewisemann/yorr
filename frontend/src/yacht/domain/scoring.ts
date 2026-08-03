import type { DiceSet, DiceValue } from './dice'

export const YACHT_UPPER_CATEGORIES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const

export const YACHT_LOWER_CATEGORIES = [
  'choice',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
] as const

export const YACHT_CATEGORIES = [...YACHT_UPPER_CATEGORIES, ...YACHT_LOWER_CATEGORIES] as const

export type YachtCategory = (typeof YACHT_CATEGORIES)[number]
export type YachtUpperCategory = (typeof YACHT_UPPER_CATEGORIES)[number]
export type YachtLowerCategory = (typeof YACHT_LOWER_CATEGORIES)[number]

export const UPPER_BONUS_THRESHOLD = 63
export const UPPER_BONUS_POINTS = 35

export type CategoryScores = Partial<Record<YachtCategory, number>>

export interface ScoreSummary {
  categories: CategoryScores
  upperSubtotal: number
  upperBonus: number
  lowerSubtotal: number
  total: number
}

const upperFaceByCategory: Record<YachtUpperCategory, DiceValue> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
}

export function scoreCategory(dice: DiceSet, category: YachtCategory): number {
  const counts = countFaces(dice)
  const total = sumDice(dice)

  if (isUpperCategory(category)) {
    const face = upperFaceByCategory[category]
    return (counts[face] ?? 0) * face
  }

  switch (category) {
    case 'choice':
      return total
    case 'fourOfAKind':
      return counts.some((count) => count >= 4) ? total : 0
    case 'fullHouse': {
      const groups = counts.filter((count) => count > 0).sort((left, right) => left - right)
      return groups.length === 2 && groups[0] === 2 && groups[1] === 3 ? total : 0
    }
    case 'smallStraight':
      return hasStraight(dice, 4) ? 15 : 0
    case 'largeStraight':
      return hasStraight(dice, 5) ? 30 : 0
    case 'yacht':
      return counts.some((count) => count === 5) ? 50 : 0
  }
}

export function calculateScoreCandidates(
  dice: DiceSet,
  usedCategories: Iterable<YachtCategory> = [],
): CategoryScores {
  const used = new Set(usedCategories)
  return Object.fromEntries(
    YACHT_CATEGORIES.filter((category) => !used.has(category)).map((category) => [
      category,
      scoreCategory(dice, category),
    ]),
  )
}

export function calculateScoreSummary(categories: CategoryScores): ScoreSummary {
  const upperSubtotal = YACHT_UPPER_CATEGORIES.reduce(
    (subtotal, category) => subtotal + (categories[category] ?? 0),
    0,
  )
  const upperBonus = upperSubtotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_POINTS : 0
  const lowerSubtotal = YACHT_LOWER_CATEGORIES.reduce(
    (subtotal, category) => subtotal + (categories[category] ?? 0),
    0,
  )

  return {
    categories: { ...categories },
    upperSubtotal,
    upperBonus,
    lowerSubtotal,
    total: upperSubtotal + upperBonus + lowerSubtotal,
  }
}

export function isUpperCategory(category: YachtCategory): category is YachtUpperCategory {
  return (YACHT_UPPER_CATEGORIES as readonly YachtCategory[]).includes(category)
}

function countFaces(dice: DiceSet) {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  for (const value of dice) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function sumDice(dice: DiceSet) {
  return dice.reduce((total, value) => total + value, 0)
}

function hasStraight(dice: DiceSet, length: 4 | 5) {
  const unique = new Set<number>(dice)
  const starts = length === 4 ? [1, 2, 3] : [1, 2]
  return starts.some((start) =>
    Array.from({ length }, (_, offset) => start + offset).every((value) => unique.has(value)),
  )
}
