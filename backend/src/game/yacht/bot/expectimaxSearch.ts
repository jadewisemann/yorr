import {
  DICE_COUNT,
  SCORE_CATEGORIES,
  type ScoreBoard,
  type ScoreCategory,
} from '../../score/index.js'
import { BotDecisionError, BotSearchBudgetError } from './botErrors.js'
import { addCounts, holdPatterns, MAX_ROLL_COUNT } from './expectimaxDiceMath.js'
import { ENCODE_SPACE, encode, OUTCOMES_BY_DICE_COUNT } from './expectimaxOutcomes.js'
import { chooseBestScore, type ScoreChoice } from './expectimaxScoreChoice.js'
import type { ScorecardValueEvaluator } from './scorecardValueEvaluator.js'

/**
 * expectimax **탐색 본체** — 메모·예산 감시·킵 기대값 계산.
 *
 * 정책(`expectimaxYachtBotPolicy.ts`)은 공개 진입점(`decide`)의 경계 판단만 하고,
 * 이 클래스가 "이 상태의 가치는 얼마인가"를 답한다. 남은 리롤 수가 깊이다.
 *
 * 메모는 점수판에 의존하므로 **탐색 하나의 수명 = `decide` 호출 하나**다(다른
 * 플레이어·다른 라운드면 같은 주사위의 가치가 다르다).
 */

/** 킵 선택. */
export interface HoldChoice {
  readonly heldCounts: readonly number[]
  readonly expectedUtility: number
  readonly kept: number
}

/** 기대값이 같으면 **더 많이 킵하는** 쪽이 이긴다(불필요한 리롤 연출을 줄인다). */
const isBetterHold = (candidate: HoldChoice, best: HoldChoice): boolean =>
  candidate.expectedUtility > best.expectedUtility ||
  (candidate.expectedUtility === best.expectedUtility && candidate.kept > best.kept)

export interface Search {
  readonly stateValue: (diceCounts: readonly number[], rerollsRemaining: number) => number
  readonly bestScore: (diceCounts: readonly number[]) => ScoreChoice
  readonly bestHold: (diceCounts: readonly number[], rerollsRemaining: number) => HoldChoice
}

export class ExpectimaxSearch implements Search {
  private readonly openCategories: readonly ScoreCategory[]
  private readonly memoized = new Map<number, number>()
  private readonly startedAt: number

  constructor(
    private readonly board: ScoreBoard,
    private readonly evaluator: ScorecardValueEvaluator,
    private readonly budgetMs: number,
    private readonly now: () => number,
  ) {
    this.openCategories = SCORE_CATEGORIES.filter((category) => board.categories[category] === null)
    if (this.openCategories.length === 0) {
      throw new BotDecisionError('AI bot has no open score category')
    }
    this.startedAt = this.now()
  }

  private requireBudget(): void {
    const elapsed = this.now() - this.startedAt
    if (elapsed > this.budgetMs) throw new BotSearchBudgetError(this.budgetMs, elapsed)
  }

  bestScore = (diceCounts: readonly number[]): ScoreChoice =>
    chooseBestScore(this.board, this.openCategories, this.evaluator, diceCounts)

  /** 키를 이미 알고 있을 때의 진입점 — 메모 적중이면 배열을 만들지 않는다. */
  private valueAtKey = (
    key: number,
    diceCounts: () => readonly number[],
    rerollsRemaining: number,
  ): number => {
    const cached = this.memoized.get(key)
    if (cached !== undefined) return cached
    this.requireBudget()
    const counts = diceCounts()
    const scoreValue = this.bestScore(counts).utility
    const calculated =
      rerollsRemaining === 0
        ? scoreValue
        : Math.max(scoreValue, this.bestHold(counts, rerollsRemaining).expectedUtility)
    this.memoized.set(key, calculated)
    return calculated
  }

  stateValue = (diceCounts: readonly number[], rerollsRemaining: number): number =>
    this.valueAtKey(
      rerollsRemaining * ENCODE_SPACE + encode(diceCounts),
      () => diceCounts,
      rerollsRemaining,
    )

  bestHold = (diceCounts: readonly number[], rerollsRemaining: number): HoldChoice => {
    let best: HoldChoice | null = null
    const childLevel = (rerollsRemaining - 1) * ENCODE_SPACE
    for (const pattern of holdPatterns(diceCounts)) {
      const kept = pattern.reduce((sum, count) => sum + count, 0)
      const patternEncoded = encode(pattern)
      let expectedUtility = 0
      for (const outcome of OUTCOMES_BY_DICE_COUNT[DICE_COUNT - kept] ?? []) {
        expectedUtility +=
          outcome.probability *
          this.valueAtKey(
            childLevel + patternEncoded + outcome.encoded,
            () => addCounts(pattern, outcome.counts),
            rerollsRemaining - 1,
          )
      }
      const candidate: HoldChoice = { heldCounts: pattern, expectedUtility, kept }
      if (best === null || isBetterHold(candidate, best)) best = candidate
    }
    if (best === null) {
      throw new BotDecisionError('AI bot has no legal reroll action')
    }
    return best
  }
}

/** 탐색 밖에서도 쓰는 상한 — 정책의 `decide`가 이 값으로 "리롤 없음"을 판정한다. */
export { MAX_ROLL_COUNT }
