import { DICE_COUNT, type ScoreBoard, type ScoreCategory } from '../../score/index.js'
import { BotDecisionError } from './botErrors.js'
import { countsOf, MAX_ROLL_COUNT, toHeldFlags } from './expectimaxDiceMath.js'
import { ExpectimaxSearch, type Search } from './expectimaxSearch.js'
import type { ScorecardValueEvaluator } from './scorecardValueEvaluator.js'

/**
 * 야추 봇의 주 정책 — **진입점과 경계 판단**.
 *
 * 남은 리롤 수(0..2)가 깊이인 expectimax다. 확률 노드는 **다항 분포 정확 계산**이고
 * 샘플링이 아니다(같은 상태에서 같은 답이 나오는 것이 재현·테스트의 전제다).
 * "다섯 개 다 킵"은 킵 후보에서 빼고 SCORE로 표현한다 — 그래야 "리롤 없음"이 두 갈래로
 * 갈라지지 않는다.
 *
 * 갈라 둔 파일:
 * - `expectimaxDiceMath.ts` — counts 조작·킵 패턴
 * - `expectimaxOutcomes.ts` — 결과 분포와 정확 확률
 * - `expectimaxScoreChoice.ts` — 지금 기록할 최선의 칸
 * - `expectimaxSearch.ts` — 메모·예산 감시·킵 기대값
 *
 * ## CPU 예산
 *
 * Node는 단일 스레드라 탐색이 도는
 * 동안 **관계없는 다른 방들의 WS 메시지·하트비트·라운드 마감이 그 뒤에 줄을 선다.**
 * 그래서 탐색 시간 상한(기본 250ms)을 테스트 단정이 아니라 **런타임 불변식**으로 승격시켰다: 예산을 넘기면
 * {@link BotSearchBudgetError}로 스스로 중단하고 코디네이터가
 * `LocalYachtBotStrategy`(탐색 없음)로 내려간다. 근거·대안 비교는
 * docs/design/games/yacht.md 「봇 스택 — CPU 예산과 이벤트 루프」에 있다.
 */

/** 기대값 차이가 이 안이면 지금 확정한다 — 미세한 우위를 위해 턴을 더 쓰지 않는다. */
const EARLY_SCORE_MARGIN = 0.15

/**
 * 턴당 CPU 예산 기본값. 넘기면 탐색을 버리고 폴백 전략으로 둔다 — 곧 이벤트 루프 점유의 상한이다.
 * 무거운 결정의 실측 p99가 코어 하나에서 18ms, 0.5 vCore(Botkeep)에서 그 두 배쯤이다. 250ms는
 * 정상 탐색이 닿지 않으면서 병리적 상황의 정지를 1초에서 4분의 1로 줄인다(yacht.md 「CPU 예산」).
 */
export const DEFAULT_SEARCH_BUDGET_MS = 250

export type BotAction = 'HOLD' | 'SCORE'

/** 봇의 결정. `SCORE`면 `held`가 비고 `category`가 찬다. */
export interface BotDecision {
  readonly action: BotAction
  readonly held: readonly boolean[]
  readonly category: ScoreCategory | null
  readonly expectedUtility: number
}

export const holdDecision = (held: readonly boolean[], expectedUtility: number): BotDecision => ({
  action: 'HOLD',
  held: Object.freeze([...held]),
  category: null,
  expectedUtility,
})

export const scoreDecision = (category: ScoreCategory, expectedUtility: number): BotDecision => ({
  action: 'SCORE',
  held: Object.freeze([]),
  category,
  expectedUtility,
})

const requireState = (board: ScoreBoard, dice: readonly number[], rollCount: number): void => {
  if (board === null || board === undefined) {
    throw new BotDecisionError('scoreboard is required')
  }
  if (
    !Array.isArray(dice) ||
    dice.length !== DICE_COUNT ||
    dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6)
  ) {
    throw new BotDecisionError('exactly five dice between 1 and 6 are required')
  }
  if (rollCount < 1 || rollCount > MAX_ROLL_COUNT) {
    throw new BotDecisionError('roll count must be between 1 and 3')
  }
}

export interface ExpectimaxYachtBotPolicyOptions {
  /**
   * 탐색 하나에 허용하는 벽시계 시간(ms). 넘기면 {@link BotSearchBudgetError}.
   *
   * **주입 가능한 것이 계약이다**: 테스트가 실시간 1초를 기다리지 않고 예산 초과
   * 경로를 재현할 수 있어야 하고(0을 넣는다), 운영에서 코어가 더 느려지면
   * 값을 내려 이벤트 루프 점유를 줄일 수 있어야 한다.
   */
  readonly budgetMs?: number
  readonly now?: () => number
}

export class ExpectimaxYachtBotPolicy {
  private readonly valueEvaluator: ScorecardValueEvaluator
  private readonly budgetMs: number
  private readonly now: () => number

  constructor(
    valueEvaluator: ScorecardValueEvaluator,
    options: ExpectimaxYachtBotPolicyOptions = {},
  ) {
    this.valueEvaluator = valueEvaluator
    this.budgetMs = options.budgetMs ?? DEFAULT_SEARCH_BUDGET_MS
    this.now = options.now ?? Date.now
  }

  /**
   * 이 주사위·이 굴림 번호에서 무엇을 할지.
   *
   * `rollCount === 3`이면 리롤이 없으므로 무조건 SCORE다. 그 전에는 "지금 확정"의
   * 가치와 "최선의 킵 후 기대값"을 비교하고, {@link EARLY_SCORE_MARGIN} 안이면
   * 확정을 고른다.
   */
  decide(board: ScoreBoard, dice: readonly number[], rollCount: number): BotDecision {
    requireState(board, dice, rollCount)
    const search = this.createSearch(board)
    const diceCounts = countsOf(dice)
    const scoreChoice = search.bestScore(diceCounts)
    if (rollCount === MAX_ROLL_COUNT) {
      return scoreDecision(scoreChoice.category, scoreChoice.utility)
    }

    const holdChoice = search.bestHold(diceCounts, MAX_ROLL_COUNT - rollCount)
    if (scoreChoice.utility + EARLY_SCORE_MARGIN >= holdChoice.expectedUtility) {
      return scoreDecision(scoreChoice.category, scoreChoice.utility)
    }
    return holdDecision(toHeldFlags(dice, holdChoice.heldCounts), holdChoice.expectedUtility)
  }

  private createSearch(board: ScoreBoard): Search {
    return new ExpectimaxSearch(board, this.valueEvaluator, this.budgetMs, this.now)
  }
}
