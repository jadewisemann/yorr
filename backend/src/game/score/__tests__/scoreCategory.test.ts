import { describe, expect, it } from 'vitest'
import { SUBMITTABLE_CATEGORIES } from '../../round/index.js'
import {
  isSatisfiedBy,
  isUpperCategory,
  SCORE_CATEGORIES,
  SCORE_CATEGORY_INFO,
  type ScoreCategory,
  scoreCategoryOf,
} from '../scoreCategory.js'
import { ScoreDomainError } from '../scoreErrors.js'

// backend-java `ScoreCategoryTest` 이식.
describe('ScoreCategory', () => {
  it('12종을 선언 순서 그대로 가진다', () => {
    expect([...SCORE_CATEGORIES]).toEqual([
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
    for (const category of SCORE_CATEGORIES) {
      expect(scoreCategoryOf(category)).toBe(category)
    }
  })

  /**
   * 라운드 도메인이 같은 목록을 **따로** 들고 있다(의도된 중복 — Java와 같은 경계).
   * 갈라지면 "제출은 되는데 점수를 못 매기는" 카테고리가 생기므로 여기서 못박는다.
   */
  it('라운드 도메인의 제출 가능 카테고리 목록과 순서·철자가 같다', () => {
    expect([...SCORE_CATEGORIES]).toEqual([...SUBMITTABLE_CATEGORIES])
  })

  it('모르는 apiKey는 거부한다', () => {
    expect(() => scoreCategoryOf('unknown')).toThrow(ScoreDomainError)
  })

  it('앞 6종만 상단 카테고리다', () => {
    expect(SCORE_CATEGORIES.filter(isUpperCategory)).toEqual([
      'ones',
      'twos',
      'threes',
      'fours',
      'fives',
      'sixes',
    ])
  })

  it('모든 카테고리에 표시용 이름과 설명이 있다', () => {
    for (const category of SCORE_CATEGORIES) {
      expect(SCORE_CATEGORY_INFO[category].label.trim()).not.toBe('')
      expect(SCORE_CATEGORY_INFO[category].description.trim()).not.toBe('')
    }
  })

  it('상단 카테고리는 해당 눈이 하나라도 있으면 충족한다', () => {
    const dice = [1, 2, 3, 4, 5]
    expect(isSatisfiedBy('ones', dice)).toBe(true)
    expect(isSatisfiedBy('twos', dice)).toBe(true)
    expect(isSatisfiedBy('threes', dice)).toBe(true)
    expect(isSatisfiedBy('fours', dice)).toBe(true)
    expect(isSatisfiedBy('fives', dice)).toBe(true)
    expect(isSatisfiedBy('sixes', dice)).toBe(false)
  })

  it('choice는 유효한 주사위면 항상 충족한다', () => {
    expect(isSatisfiedBy('choice', [1, 1, 2, 4, 6])).toBe(true)
  })

  it('fourOfAKind는 같은 눈 4개 또는 5개로 충족한다', () => {
    expect(isSatisfiedBy('fourOfAKind', [4, 4, 4, 4, 2])).toBe(true)
    expect(isSatisfiedBy('fourOfAKind', [6, 6, 6, 6, 6])).toBe(true)
    expect(isSatisfiedBy('fourOfAKind', [3, 3, 3, 2, 2])).toBe(false)
  })

  it('fullHouse는 정확히 3+2일 때만 충족한다(5개 동일은 불충족)', () => {
    expect(isSatisfiedBy('fullHouse', [2, 5, 2, 5, 5])).toBe(true)
    expect(isSatisfiedBy('fullHouse', [6, 6, 6, 6, 6])).toBe(false)
    expect(isSatisfiedBy('fullHouse', [3, 3, 3, 2, 1])).toBe(false)
  })

  it('smallStraight는 중복을 제거한 뒤 연속 4개를 본다', () => {
    expect(isSatisfiedBy('smallStraight', [1, 2, 3, 4, 6])).toBe(true)
    expect(isSatisfiedBy('smallStraight', [2, 3, 4, 5, 5])).toBe(true)
    expect(isSatisfiedBy('smallStraight', [3, 3, 4, 5, 6])).toBe(true)
    expect(isSatisfiedBy('smallStraight', [1, 2, 2, 4, 5])).toBe(false)
  })

  it('largeStraight는 연속 5개일 때만 충족한다', () => {
    expect(isSatisfiedBy('largeStraight', [1, 2, 3, 4, 5])).toBe(true)
    expect(isSatisfiedBy('largeStraight', [6, 2, 5, 3, 4])).toBe(true)
    expect(isSatisfiedBy('largeStraight', [1, 2, 3, 4, 4])).toBe(false)
    expect(isSatisfiedBy('largeStraight', [1, 2, 3, 5, 6])).toBe(false)
  })

  it('yacht는 5개가 모두 같을 때만 충족한다', () => {
    expect(isSatisfiedBy('yacht', [5, 5, 5, 5, 5])).toBe(true)
    expect(isSatisfiedBy('yacht', [5, 5, 5, 5, 4])).toBe(false)
  })

  it('주사위 순서는 판정에 영향을 주지 않는다', () => {
    expect(isSatisfiedBy('fullHouse', [2, 2, 5, 5, 5])).toBe(
      isSatisfiedBy('fullHouse', [5, 2, 5, 2, 5]),
    )
    expect(isSatisfiedBy('largeStraight', [1, 2, 3, 4, 5])).toBe(
      isSatisfiedBy('largeStraight', [5, 3, 1, 4, 2]),
    )
  })

  it.each([
    ['null', null],
    ['4개', [1, 2, 3, 4]],
    ['6개', [1, 2, 3, 4, 5, 6]],
    ['0의 눈', [0, 1, 2, 3, 4]],
    ['7의 눈', [1, 2, 3, 4, 7]],
  ])('잘못된 주사위(%s)는 0점이 아니라 예외다', (_label, dice) => {
    expect(() => isSatisfiedBy('choice', dice as unknown as number[])).toThrow(ScoreDomainError)
  })

  it('타입 가드는 모르는 문자열을 카테고리로 좁히지 않는다', () => {
    const candidate: string = 'ones'
    const category: ScoreCategory = scoreCategoryOf(candidate)
    expect(category).toBe('ones')
  })
})
