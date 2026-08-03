import { describe, expect, it } from 'vitest'
import type { DiceSet } from '@/yacht/domain/dice'
import { detectSpecialHand } from '@/yacht/domain/specialHands'

describe('detectSpecialHand', () => {
  it('아무 족보도 성립하지 않으면 null', () => {
    expect(detectSpecialHand([1, 2, 4, 6, 6] as DiceSet)).toBeNull()
  })

  it('성립한 족보 중 가장 높은 것을 고른다 — 야트는 포카인드보다 우선', () => {
    expect(detectSpecialHand([5, 5, 5, 5, 5] as DiceSet)).toBe('yacht')
    expect(detectSpecialHand([5, 5, 5, 5, 2] as DiceSet)).toBe('fourOfAKind')
  })

  it('라지 스트레이트는 스몰 스트레이트보다 우선', () => {
    expect(detectSpecialHand([1, 2, 3, 4, 5] as DiceSet)).toBe('largeStraight')
    expect(detectSpecialHand([1, 2, 3, 4, 6] as DiceSet)).toBe('smallStraight')
  })

  it('풀하우스를 감지한다', () => {
    expect(detectSpecialHand([3, 3, 2, 2, 2] as DiceSet)).toBe('fullHouse')
  })
})
