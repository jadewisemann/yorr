import { describe, expect, it } from 'vitest'
import type { ScoreCategory } from '../scoreCategory.js'
import { ScoreDomainError } from '../scoreErrors.js'
import {
  calculateScore,
  calculateUpperBonus,
  calculateUpperSubtotal,
} from '../yachtScoreCalculator.js'

const upperScores = (onesScore: number): ReadonlyMap<ScoreCategory, number> =>
  new Map<ScoreCategory, number>([
    ['ones', onesScore],
    ['twos', 6],
    ['threes', 9],
    ['fours', 12],
    ['fives', 15],
    ['sixes', 18],
  ])

// backend-java `YachtScoreCalculatorTest` 이식.
describe('YachtScoreCalculator', () => {
  it('상단 카테고리는 해당 눈의 합이다', () => {
    expect(calculateScore('ones', [1, 1, 1, 2, 3])).toBe(3)
    expect(calculateScore('twos', [2, 2, 2, 1, 3])).toBe(6)
    expect(calculateScore('threes', [3, 3, 3, 1, 2])).toBe(9)
    expect(calculateScore('fours', [4, 4, 4, 1, 2])).toBe(12)
    expect(calculateScore('fives', [5, 5, 5, 1, 2])).toBe(15)
    expect(calculateScore('sixes', [6, 6, 6, 1, 2])).toBe(18)
  })

  it('상단 카테고리의 눈이 없으면 0점이다', () => {
    expect(calculateScore('ones', [2, 3, 4, 5, 6])).toBe(0)
    expect(calculateScore('sixes', [1, 2, 3, 4, 5])).toBe(0)
  })

  it('choice는 전체 합이다', () => {
    expect(calculateScore('choice', [1, 2, 3, 4, 5])).toBe(15)
  })

  it('fourOfAKind는 전체 합이고 야추 주사위로도 충족한다', () => {
    expect(calculateScore('fourOfAKind', [4, 4, 4, 4, 2])).toBe(18)
    expect(calculateScore('fourOfAKind', [6, 6, 6, 6, 6])).toBe(30)
    expect(calculateScore('fourOfAKind', [3, 3, 3, 2, 2])).toBe(0)
  })

  it('fullHouse는 전체 합이고 5개 동일은 0점이다', () => {
    expect(calculateScore('fullHouse', [2, 2, 5, 5, 5])).toBe(19)
    expect(calculateScore('fullHouse', [3, 3, 3, 2, 1])).toBe(0)
    expect(calculateScore('fullHouse', [6, 6, 6, 6, 6])).toBe(0)
  })

  it('스트레이트·야추는 고정 점수다', () => {
    expect(calculateScore('smallStraight', [1, 2, 3, 4, 6])).toBe(15)
    expect(calculateScore('largeStraight', [2, 3, 4, 5, 6])).toBe(30)
    expect(calculateScore('yacht', [5, 5, 5, 5, 5])).toBe(50)
  })

  it('불충족 족보는 전부 0점이다', () => {
    const dice = [1, 2, 2, 4, 6]
    expect(calculateScore('fourOfAKind', dice)).toBe(0)
    expect(calculateScore('fullHouse', dice)).toBe(0)
    expect(calculateScore('smallStraight', dice)).toBe(0)
    expect(calculateScore('largeStraight', dice)).toBe(0)
    expect(calculateScore('yacht', dice)).toBe(0)
  })

  it('주사위 순서는 점수를 바꾸지 않는다', () => {
    expect(calculateScore('fullHouse', [2, 2, 5, 5, 5])).toBe(
      calculateScore('fullHouse', [5, 2, 5, 2, 5]),
    )
  })

  it('소계는 상단 카테고리만 센다', () => {
    const scores = new Map<ScoreCategory, number>(upperScores(3))
    scores.set('choice', 30)
    scores.set('yacht', 50)

    expect(calculateUpperSubtotal(scores)).toBe(63)
  })

  it('보너스 경계는 63 이상이다', () => {
    expect(calculateUpperBonus(upperScores(2))).toBe(0)
    expect(calculateUpperBonus(upperScores(3))).toBe(35)
    expect(calculateUpperBonus(upperScores(4))).toBe(35)
  })

  it('카테고리가 없으면 던진다', () => {
    expect(() => calculateScore(null as unknown as ScoreCategory, [1, 2, 3, 4, 5])).toThrow(
      /카테고리/,
    )
  })

  it('잘못된 주사위는 카테고리 검증을 통해 던진다', () => {
    expect(() => calculateScore('choice', null as unknown as number[])).toThrow(ScoreDomainError)
    expect(() => calculateScore('choice', [1, 2, 3, 4])).toThrow(ScoreDomainError)
    expect(() => calculateScore('choice', [1, 2, 3, 4, 7])).toThrow(ScoreDomainError)
  })

  it('상단 점수 맵이 없거나 음수면 던진다', () => {
    expect(() =>
      calculateUpperSubtotal(null as unknown as ReadonlyMap<ScoreCategory, number>),
    ).toThrow(ScoreDomainError)
    expect(() => calculateUpperSubtotal(new Map([['ones', -1]]))).toThrow(ScoreDomainError)
    // 기록하지 않은 칸(null)은 0이 아니라 손상으로 본다 — Java와 같다.
    expect(() => calculateUpperSubtotal(new Map([['ones', null]]))).toThrow(ScoreDomainError)
  })

  it('키가 아예 없는 상단 칸은 0으로 센다', () => {
    expect(calculateUpperSubtotal(new Map([['ones', 3]]))).toBe(3)
  })
})
