import { describe, expect, it } from 'vitest'
import { LocalYachtBotStrategy } from '../localYachtBotStrategy.js'

/** `LocalYachtBotStrategyTest` 이식(4종) + 폴백 진입 조건 2종. */
describe('LocalYachtBotStrategy', () => {
  const strategy = new LocalYachtBotStrategy()

  it('최빈 면을 남긴다', () => {
    expect(strategy.chooseHeld([2, 6, 2, 4, 2])).toEqual([true, false, true, false, true])
  })

  it('스트레이트에 가까운 단독 주사위를 남긴다', () => {
    // 1-4 창에 2·3·4가 있어 3면 → 스트레이트 킵. 중복된 4는 하나만 잡는다.
    expect(strategy.chooseHeld([2, 3, 4, 4, 6])).toEqual([true, true, true, false, false])
  })

  it('스트레이트 창이 2면 이하면 최빈 면으로 내려간다', () => {
    // 1·2만 있어 1-4 창에도 2면뿐 → 스트레이트 분기가 성립하지 않는다.
    expect(strategy.chooseHeld([1, 1, 2, 2, 2])).toEqual([false, false, true, true, true])
  })

  it('최빈 개수가 같으면 높은 면이 이긴다', () => {
    expect(strategy.chooseHeld([1, 1, 6, 6, 2])).toEqual([false, false, true, true, false])
  })

  /**
   * ⚠️ Java의 `keepMostFrequentOrHigh`에는 "최빈이 단독이면 5·6만 남긴다" 분기가
   * 있는데, `chooseHeld` 경로로는 **도달할 수 없다**: 최빈이 단독이려면 5개가 전부
   * 다른 면이어야 하고, 6면 중 5면을 고르면 어떤 면이 빠져도 4연속 창 하나에는
   * 반드시 3면 이상이 들어가 스트레이트 분기가 먼저 성립한다. 그대로 옮겨 두었고
   * (동작 차이를 만들지 않는다) 발견은 IMPLEMENTATION_NOTES.md에 남겼다.
   */
  it('5개가 전부 다른 면이면 항상 스트레이트 분기로 간다', () => {
    for (const missing of [1, 2, 3, 4, 5, 6]) {
      const dice = [1, 2, 3, 4, 5, 6].filter((face) => face !== missing)
      expect(
        strategy.chooseHeld(dice).filter((flag) => flag).length,
        `missing=${missing}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('카테고리 선택은 닫힌 칸을 절대 쓰지 않는다', () => {
    expect(strategy.chooseCategory([6, 6, 6, 6, 6], ['ones', 'choice'])).toBe('choice')
  })

  it('카테고리 선택은 최고 점수를 고른다', () => {
    expect(strategy.chooseCategory([6, 6, 6, 6, 6], ['sixes', 'choice', 'yacht'])).toBe('yacht')
  })

  it('동점이면 고정 선호로 결정론적으로 깨진다', () => {
    // 1·2·3·4·5는 스몰(15)과 초이스(15)가 동점 — 선호가 큰 초이스(8 > 7)가 이긴다.
    expect(strategy.chooseCategory([1, 2, 3, 4, 5], ['smallStraight', 'choice'])).toBe('choice')
    // 순서를 뒤집어도 같은 답이 나와야 결정론이다.
    expect(strategy.chooseCategory([1, 2, 3, 4, 5], ['choice', 'smallStraight'])).toBe('choice')
  })

  it('열린 칸이 없으면 던진다', () => {
    expect(() => strategy.chooseCategory([1, 2, 3, 4, 5], [])).toThrow(/open category/)
  })

  it('주사위가 5개가 아니면 던진다', () => {
    expect(() => strategy.chooseHeld([1, 2, 3])).toThrow(/five dice/)
  })
})
