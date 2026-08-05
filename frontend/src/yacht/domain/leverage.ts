import { nextRollSeed } from './dice'
import { type CategoryScores, YACHT_CATEGORIES, type YachtCategory } from './scoring'

/**
 * 레버리지 다이스(S15P11A406-208)의 규칙층. 매 턴 족보 하나가 뽑히고, 그 족보에 기록하면
 * 점수가 배로 붙는다.
 *
 * scoring.ts는 건드리지 않는다 — 12족보의 점수는 일반 모드·서버와 공유하는 SSOT이고,
 * 여기 있는 것은 그 결과에 곱하는 변형 룰 한 겹이다. 감싸기만 하므로 이 파일을 지우면
 * 일반 야추가 그대로 남는다.
 */
export const LEVERAGE_MULTIPLIER = 2

/**
 * 이번 턴의 레버리지 족보. **시드 결정론**이다 — 같은 (시드, 라운드, 남은 족보)면 어디서
 * 계산하든 같은 족보가 나온다. 점수를 매기는 쪽(로컬 서버)과 미리보기를 그리는 쪽(화면)이
 * 서로 다른 족보를 보면 안 되므로 dice.ts의 LCG를 그대로 쓴다.
 *
 * 이미 기록한 족보는 뽑지 않는다. 다시 쓸 수 없는 칸에 2배를 걸어 봐야 그 턴은 그냥
 * 레버리지가 없는 턴이 된다.
 */
export function pickLeverageCategory(
  seed: number,
  roundNumber: number,
  used: Iterable<YachtCategory> = [],
): YachtCategory | null {
  const recorded = new Set(used)
  const open = YACHT_CATEGORIES.filter((category) => !recorded.has(category))
  if (open.length === 0) return null

  // 라운드마다 다른 족보가 나오도록 라운드 수만큼 시드를 굴린다(12라운드라 비용은 상수).
  let state = nextRollSeed(seed)
  for (let round = 0; round < roundNumber; round += 1) state = nextRollSeed(state)
  // rollDice와 같은 방식으로 상위 비트를 쓴다 — LCG의 하위 비트는 주기가 짧다.
  return open[Math.floor((state / 2 ** 32) * open.length)] ?? open[open.length - 1] ?? null
}

/** 이 족보에 걸린 배수. 레버리지 족보가 없는 턴(전부 기록됨)이면 1배다. */
export function leverageMultiplier(
  category: YachtCategory,
  leverageCategory: YachtCategory | null,
): number {
  return leverageCategory !== null && category === leverageCategory ? LEVERAGE_MULTIPLIER : 1
}

/** 미리보기 점수표에 배수를 입힌다. 기록 점수는 서버(로컬 모드에서는 leverageGame)가 정한다. */
export function applyLeverage(
  scores: CategoryScores,
  leverageCategory: YachtCategory | null,
): CategoryScores {
  if (leverageCategory === null || !(leverageCategory in scores)) return scores
  return { ...scores, [leverageCategory]: (scores[leverageCategory] ?? 0) * LEVERAGE_MULTIPLIER }
}
