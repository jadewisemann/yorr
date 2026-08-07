import { nextRollSeed } from './dice'
import { type CategoryScores, YACHT_CATEGORIES, type YachtCategory } from './scoring'

export const LEVERAGE_MULTIPLIER = 2

export function pickLeverageCategory(
  seed: number,
  roundNumber: number,
  used: Iterable<YachtCategory> = [],
): YachtCategory | null {
  const recorded = new Set(used)
  const open = YACHT_CATEGORIES.filter((category) => !recorded.has(category))
  if (open.length === 0) return null

  let state = nextRollSeed(seed)
  for (let round = 0; round < roundNumber; round += 1) state = nextRollSeed(state)
  return open[Math.floor((state / 2 ** 32) * open.length)] ?? open[open.length - 1] ?? null
}

export function leverageMultiplier(
  category: YachtCategory,
  leverageCategory: YachtCategory | null,
): number {
  return leverageCategory !== null && category === leverageCategory ? LEVERAGE_MULTIPLIER : 1
}

export function applyLeverage(
  scores: CategoryScores,
  leverageCategory: YachtCategory | null,
): CategoryScores {
  if (leverageCategory === null || !(leverageCategory in scores)) return scores
  return { ...scores, [leverageCategory]: (scores[leverageCategory] ?? 0) * LEVERAGE_MULTIPLIER }
}
