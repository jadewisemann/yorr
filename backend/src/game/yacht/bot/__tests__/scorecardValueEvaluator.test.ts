import { describe, expect, it } from 'vitest'
import { createScoreBoard, type ScoreBoard, type ScoreCategory } from '../../../score/index.js'
import { ScorecardValueEvaluator } from '../scorecardValueEvaluator.js'

/**
 * `ScorecardValueEvaluatorTest` 이식(2종).
 *
 * 절대값을 단정하지 않는다 — 상수(2.0·0.70·4.0 …)는 튜닝 대상이고, 계약은
 * **두 선택 중 어느 쪽이 큰가**다.
 */

const boardWith = (filled: Readonly<Record<string, number>>, upperSubtotal: number): ScoreBoard =>
  createScoreBoard(filled, upperSubtotal, 0, upperSubtotal)

describe('ScorecardValueEvaluator', () => {
  const evaluator = new ScorecardValueEvaluator()

  it('상단 보너스 확보가 즉시 고득점보다 높게 평가된다', () => {
    // 소계 33 + 식스 30 = 63 → 보너스 확보. 야추 50점보다 이쪽이 커야 한다.
    const board = boardWith({ ones: 3, twos: 6, threes: 9, fours: 0, fives: 15 }, 33)

    const sixes = evaluator.categoryUtility(board, 'sixes', 30)
    const yacht = evaluator.categoryUtility(board, 'yacht', 50)

    expect(sixes).toBeGreaterThan(yacht)
  })

  it('마지막 상단 보너스 기회 앞에서는 닫힌 기회를 먼저 희생한다', () => {
    // 소계 60, 남은 상단은 식스뿐 → 식스에 0을 적으면 보너스가 영구히 사라진다.
    const board = boardWith({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 30 }, 60)

    const zeroYacht = evaluator.categoryUtility(board, 'yacht', 0)
    const zeroSixes = evaluator.categoryUtility(board, 'sixes', 0)

    expect(zeroYacht).toBeGreaterThan(zeroSixes)
  })

  it('이미 채운 칸을 평가하려 하면 던진다', () => {
    // 코디네이터가 잡아 폴백으로 내려가는 경로다.
    const board = boardWith({ yacht: 0 }, 0)

    expect(() => evaluator.categoryUtility(board, 'yacht' as ScoreCategory, 50)).toThrow(
      /already filled/,
    )
  })
})
