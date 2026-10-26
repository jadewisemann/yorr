import {
  calculateScore,
  isSatisfiedBy,
  SCORE_CATEGORIES,
  type ScoreBoard,
  type ScoreCategory,
} from '../../score/index.js'
import { BotDecisionError } from './botErrors.js'
import { expand } from './expectimaxDiceMath.js'
import type { ScorecardValueEvaluator } from './scorecardValueEvaluator.js'

/**
 * 지금 이 주사위로 **어느 칸에 기록할 것인가** — 탐색의 잎 노드가 쓰는 선택 규칙.
 *
 * 정책(`expectimaxYachtBotPolicy.ts`)에서 갈라 둔 이유: 이 함수는 탐색 트리를 전혀
 * 모른다. 후보 칸의 효용을 재고 동점 규칙으로 하나를 고를 뿐이라, 탐색을 고칠 때와
 * 채점 규칙을 고칠 때 다른 파일을 열면 된다.
 */

/** 점수 선택. `ordinal`은 `SCORE_CATEGORIES`의 인덱스다. */
export interface ScoreChoice {
  readonly category: ScoreCategory
  readonly utility: number
  readonly ordinal: number
}

/** 동점이면 **뒤쪽(하단) 칸**이 이긴다. */
const isBetterScore = (candidate: ScoreChoice, best: ScoreChoice): boolean =>
  candidate.utility > best.utility ||
  (candidate.utility === best.utility && candidate.ordinal > best.ordinal)

/**
 * 이 주사위로 지금 기록할 수 있는 최선의 칸.
 *
 * **규칙이다(가지치기가 아니다).** 스몰 스트레이트가 열려 있고 충족됐다면 초이스를
 * 후보에서 뺀다. 평가기만 보면 초이스가 이길 때가 있지만(빈 판의 [3,4,5,6,6]은 효용이
 * 3.4 높다) 초이스는 나중의 버림 칸으로 남겨 두는 것이 이 봇의 플레이 방식이다 —
 * 이식한 테스트 「지켜낸 스몰을 기록한다」가 그 계약이다. 예전 주석은 이것을 "결정을
 * 바꾸지 않는 순수한 pruning"이라 불렀는데 틀렸다. 오라클 차등 테스트가 그 차이를 잡았다
 * (`__tests__/expectimaxOracle.test.ts`, `test/oracles/yachtBot.ts` 규칙 5).
 */
export const chooseBestScore = (
  board: ScoreBoard,
  openCategories: readonly ScoreCategory[],
  evaluator: ScorecardValueEvaluator,
  diceCounts: readonly number[],
): ScoreChoice => {
  const dice = expand(diceCounts)
  const choiceDominated =
    openCategories.includes('smallStraight') && isSatisfiedBy('smallStraight', dice)
  let best: ScoreChoice | null = null
  for (const category of openCategories) {
    if (category === 'choice' && choiceDominated) continue
    const candidate: ScoreChoice = {
      category,
      utility: evaluator.categoryUtility(board, category, calculateScore(category, dice)),
      ordinal: SCORE_CATEGORIES.indexOf(category),
    }
    if (best === null || isBetterScore(candidate, best)) best = candidate
  }
  if (best === null) throw new BotDecisionError('AI bot has no open score category')
  return best
}
