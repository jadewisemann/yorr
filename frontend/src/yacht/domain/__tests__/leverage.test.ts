import { describe, expect, it } from 'vitest'
import {
  applyLeverage,
  LEVERAGE_MULTIPLIER,
  leverageMultiplier,
  pickLeverageCategory,
} from '@/yacht/domain/leverage'
import { YACHT_CATEGORIES, type YachtCategory } from '@/yacht/domain/scoring'

describe('레버리지 족보 선정', () => {
  it('같은 시드·라운드면 같은 족보다 — 모든 화면이 같은 것을 봐야 한다', () => {
    for (let round = 1; round <= 12; round += 1) {
      expect(pickLeverageCategory(20260805, round)).toBe(pickLeverageCategory(20260805, round))
    }
  })

  it('시드가 다르면 뽑히는 족보도 갈린다', () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, seed) => pickLeverageCategory(seed * 7919, 1)),
    )

    expect(picks.size).toBeGreaterThan(1)
  })

  it('아직 기록하지 않은 족보만 뽑는다', () => {
    const used = YACHT_CATEGORIES.slice(0, 11)

    for (let round = 1; round <= 12; round += 1) {
      expect(pickLeverageCategory(1234 + round, round, used)).toBe('yacht')
    }
  })

  it('12칸을 모두 기록했으면 뽑을 족보가 없다', () => {
    expect(pickLeverageCategory(1234, 12, YACHT_CATEGORIES)).toBeNull()
  })

  it('선정 결과는 언제나 실제 족보 키다', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const picked = pickLeverageCategory(seed, seed % 12)
      expect(YACHT_CATEGORIES).toContain(picked as YachtCategory)
    }
  })
})

describe('레버리지 배수', () => {
  it('뽑힌 족보에만 배수가 붙는다', () => {
    expect(leverageMultiplier('yacht', 'yacht')).toBe(LEVERAGE_MULTIPLIER)
    expect(leverageMultiplier('choice', 'yacht')).toBe(1)
    expect(leverageMultiplier('yacht', null)).toBe(1)
  })

  it('미리보기 점수표는 해당 칸만 2배가 된다', () => {
    const doubled = applyLeverage({ choice: 17, yacht: 50 }, 'yacht')

    expect(doubled).toEqual({ choice: 17, yacht: 100 })
  })

  it('0점 칸은 2배여도 0점이다 — 레버리지가 손실을 만들지 않는다', () => {
    expect(applyLeverage({ yacht: 0 }, 'yacht')).toEqual({ yacht: 0 })
  })

  it('이미 기록한 족보가 뽑혔거나 레버리지가 없으면 점수표를 그대로 둔다', () => {
    const scores = { choice: 17 }

    expect(applyLeverage(scores, 'yacht')).toBe(scores)
    expect(applyLeverage(scores, null)).toBe(scores)
  })
})
