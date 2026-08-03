import { describe, expect, it } from 'vitest'
import { createDiceSet } from '@/yacht/domain/dice'
import {
  calculateScoreCandidates,
  calculateScoreSummary,
  scoreCategory,
  YACHT_CATEGORIES,
} from '@/yacht/domain/scoring'

describe('scoring', () => {
  it.each([
    ['ones', [1, 1, 1, 4, 5], 3],
    ['twos', [2, 2, 2, 4, 5], 6],
    ['threes', [3, 3, 3, 4, 5], 9],
    ['fours', [4, 4, 4, 2, 3], 12],
    ['fives', [5, 5, 5, 2, 3], 15],
    ['sixes', [6, 6, 6, 2, 3], 18],
    ['choice', [1, 2, 3, 4, 5], 15],
    ['fourOfAKind', [6, 6, 6, 6, 5], 29],
    ['fullHouse', [2, 2, 3, 3, 3], 13],
    ['smallStraight', [1, 2, 3, 4, 6], 15],
    ['largeStraight', [2, 3, 4, 5, 6], 30],
    ['yacht', [6, 6, 6, 6, 6], 50],
  ] as const)('scores %s', (category, dice, expected) => {
    expect(scoreCategory(createDiceSet(dice), category)).toBe(expected)
  })

  it('keeps all twelve categories in their scoreboard order', () => {
    expect(YACHT_CATEGORIES).toEqual([
      'ones',
      'twos',
      'threes',
      'fours',
      'fives',
      'sixes',
      'choice',
      'fourOfAKind',
      'fullHouse',
      'smallStraight',
      'largeStraight',
      'yacht',
    ])
  })

  it('returns zero when a lower category condition is not met', () => {
    expect(scoreCategory(createDiceSet([1, 1, 2, 2, 4]), 'fullHouse')).toBe(0)
    expect(scoreCategory(createDiceSet([1, 1, 1, 2, 3]), 'fourOfAKind')).toBe(0)
    expect(scoreCategory(createDiceSet([1, 2, 3, 4, 6]), 'largeStraight')).toBe(0)
    expect(scoreCategory(createDiceSet([6, 6, 6, 6, 5]), 'yacht')).toBe(0)
  })

  it('handles duplicate dice in small straights and both large straight patterns', () => {
    expect(scoreCategory(createDiceSet([1, 2, 2, 3, 4]), 'smallStraight')).toBe(15)
    expect(scoreCategory(createDiceSet([2, 3, 4, 5, 6]), 'smallStraight')).toBe(15)
    expect(scoreCategory(createDiceSet([1, 2, 3, 4, 5]), 'largeStraight')).toBe(30)
    expect(scoreCategory(createDiceSet([2, 3, 4, 5, 6]), 'largeStraight')).toBe(30)
  })

  it('excludes used categories even when their confirmed score is zero', () => {
    const candidates = calculateScoreCandidates(createDiceSet([1, 2, 3, 4, 5]), [
      'ones',
      'fullHouse',
    ])

    expect(candidates.ones).toBeUndefined()
    expect(candidates.fullHouse).toBeUndefined()
    expect(candidates.largeStraight).toBe(30)
  })

  it('applies the upper bonus at 63 points and includes lower scores in the total', () => {
    const below = calculateScoreSummary({
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 17,
    })
    const threshold = calculateScoreSummary({ ...below.categories, sixes: 18, choice: 20 })

    expect(below).toMatchObject({ upperSubtotal: 62, upperBonus: 0, total: 62 })
    expect(threshold).toMatchObject({
      upperSubtotal: 63,
      upperBonus: 35,
      lowerSubtotal: 20,
      total: 118,
    })
  })
})
