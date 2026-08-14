import {
  calculateScore,
  DICE_COUNT,
  isSatisfiedBy,
  SCORE_CATEGORIES,
  type ScoreBoard,
  type ScoreCategory,
} from '../../score/index.js'
import { BotDecisionError, BotSearchBudgetError } from './botErrors.js'
import type { ScorecardValueEvaluator } from './scorecardValueEvaluator.js'

/**
 * 야추 봇의 주 정책 — backend-java `ExpectimaxYachtBotPolicy`.
 *
 * 남은 리롤 수(0..2)가 깊이인 expectimax다. 확률 노드는 **다항 분포 정확 계산**이고
 * 샘플링이 아니다(같은 상태에서 같은 답이 나오는 것이 재현·테스트의 전제다).
 * "다섯 개 다 킵"은 킵 후보에서 빼고 SCORE로 표현한다 — 그래야 "리롤 없음"이 두 갈래로
 * 갈라지지 않는다.
 *
 * ## CPU 예산 (Java와 다른 부분)
 *
 * Java는 이 탐색을 2스레드 데몬 풀에서 돌렸다. Node는 단일 스레드라 탐색이 도는
 * 동안 **관계없는 다른 방들의 WS 메시지·하트비트·라운드 마감이 그 뒤에 줄을 선다.**
 * 그래서 1초를 테스트 단정이 아니라 **런타임 불변식**으로 승격시켰다: 예산을 넘기면
 * {@link BotSearchBudgetError}로 스스로 중단하고 코디네이터가
 * `LocalYachtBotStrategy`(탐색 없음)로 내려간다. 근거·대안 비교는
 * docs/design/games/yacht.md 「봇 스택 — CPU 예산과 이벤트 루프」에 있다.
 */

const FACE_COUNT = 6
const MAX_ROLL_COUNT = 3
/** 기대값 차이가 이 안이면 지금 확정한다 — 미세한 우위를 위해 턴을 더 쓰지 않는다. */
const EARLY_SCORE_MARGIN = 0.15
/** counts 인코딩의 자리수(면당 0..5 → base 6). `6^6`이 키 공간의 상한이다. */
const ENCODE_BASE = DICE_COUNT + 1
const ENCODE_SPACE = ENCODE_BASE ** FACE_COUNT

/** 턴당 CPU 예산 기본값. Java 테스트가 성능 계약으로 고정한 그 1초다. */
export const DEFAULT_SEARCH_BUDGET_MS = 1_000

export type BotAction = 'HOLD' | 'SCORE'

/** Java `BotDecision` record 자리. `SCORE`면 `held`가 비고 `category`가 찬다. */
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

interface DiceOutcome {
  readonly counts: readonly number[]
  readonly probability: number
  /**
   * `encode(counts)`를 미리 계산해 둔 값. base-6 인코딩은 **자리올림이 없으므로**
   * (면당 개수 ≤ 5 < 6) `encode(a + b) === encode(a) + encode(b)`다 — 킵 패턴과
   * 결과를 더한 상태의 메모 키를 배열 할당 없이 만들 수 있다.
   */
  readonly encoded: number
}

/** counts를 base-6 한 자리씩 담은 정수로. 메모 키의 하위 절반이다. */
const encode = (counts: readonly number[]): number => {
  let encoded = 0
  let place = 1
  for (const count of counts) {
    encoded += count * place
    place *= ENCODE_BASE
  }
  return encoded
}

const factorial = (value: number): number => {
  let result = 1
  for (let factor = 2; factor <= value; factor += 1) result *= factor
  return result
}

/** 다항 계수 / 6^n. 주사위 n개를 굴려 이 면 분포가 나올 확률(정확값). */
const outcomeProbability = (counts: readonly number[]): number => {
  const total = counts.reduce((sum, count) => sum + count, 0)
  let permutations = factorial(total)
  for (const count of counts) permutations /= factorial(count)
  return permutations / FACE_COUNT ** total
}

const collectOutcomes = (
  remaining: number,
  faceIndex: number,
  counts: number[],
  outcomes: DiceOutcome[],
): void => {
  if (faceIndex === FACE_COUNT - 1) {
    counts[faceIndex] = remaining
    const copy = [...counts]
    outcomes.push({
      counts: copy,
      probability: outcomeProbability(copy),
      encoded: encode(copy),
    })
    counts[faceIndex] = 0
    return
  }
  for (let count = 0; count <= remaining; count += 1) {
    counts[faceIndex] = count
    collectOutcomes(remaining - count, faceIndex + 1, counts, outcomes)
  }
  counts[faceIndex] = 0
}

/**
 * 리롤 개수(0..5)별 결과 분포. 모듈 로드 시 한 번만 만든다 —
 * 총 1+6+21+56+126+252 = 462개로, 방마다 다시 만들 이유가 없다(Java의 static도 같다).
 */
const OUTCOMES_BY_DICE_COUNT: readonly (readonly DiceOutcome[])[] = (() => {
  const table: DiceOutcome[][] = []
  for (let diceCount = 0; diceCount <= DICE_COUNT; diceCount += 1) {
    const outcomes: DiceOutcome[] = []
    collectOutcomes(diceCount, 0, new Array<number>(FACE_COUNT).fill(0), outcomes)
    table.push(outcomes)
  }
  return table
})()

const countsOf = (dice: readonly number[]): number[] => {
  const counts = new Array<number>(FACE_COUNT).fill(0)
  for (const die of dice) counts[die - 1] = (counts[die - 1] ?? 0) + 1
  return counts
}

const addCounts = (first: readonly number[], second: readonly number[]): number[] => {
  const result = new Array<number>(FACE_COUNT)
  for (let index = 0; index < FACE_COUNT; index += 1) {
    result[index] = (first[index] ?? 0) + (second[index] ?? 0)
  }
  return result
}

/** counts → 오름차순 주사위 5개. 채점은 순서에 무관하므로 정렬 형태로 충분하다. */
const expand = (counts: readonly number[]): number[] => {
  const dice = new Array<number>(DICE_COUNT)
  let index = 0
  for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
    for (let count = 0; count < (counts[faceIndex] ?? 0); count += 1) {
      dice[index] = faceIndex + 1
      index += 1
    }
  }
  return dice
}

/**
 * 킵 후보 = 현재 counts의 **모든 부분 다중집합**에서 "5개 전부"를 뺀 것.
 *
 * 열거 순서가 계약이다(마지막 면이 가장 빨리 변한다). 기대값이 완전히 같은 두 킵의
 * 승자를 이 순서가 정하므로, 순서를 바꾸면 봇의 결정이 조용히 달라진다.
 */
const holdPatterns = (diceCounts: readonly number[]): number[][] => {
  const patterns: number[][] = []
  const heldCounts = new Array<number>(FACE_COUNT).fill(0)
  const walk = (faceIndex: number, kept: number): void => {
    if (faceIndex === FACE_COUNT) {
      if (kept < DICE_COUNT) patterns.push([...heldCounts])
      return
    }
    const available = diceCounts[faceIndex] ?? 0
    for (let count = 0; count <= available; count += 1) {
      heldCounts[faceIndex] = count
      walk(faceIndex + 1, kept + count)
    }
    heldCounts[faceIndex] = 0
  }
  walk(0, 0)
  return patterns
}

/** 킵 counts → 주사위 자리별 플래그. 같은 면이 여러 개면 **앞자리부터** 잡는다. */
const toHeldFlags = (dice: readonly number[], heldCounts: readonly number[]): boolean[] => {
  const remaining = [...heldCounts]
  return dice.map((die) => {
    const held = (remaining[die - 1] ?? 0) > 0
    if (held) remaining[die - 1] = (remaining[die - 1] ?? 0) - 1
    return held
  })
}

const requireState = (board: ScoreBoard, dice: readonly number[], rollCount: number): void => {
  if (board === null || board === undefined) {
    throw new BotDecisionError('scoreboard is required')
  }
  if (
    !Array.isArray(dice) ||
    dice.length !== DICE_COUNT ||
    dice.some((die) => !Number.isInteger(die) || die < 1 || die > FACE_COUNT)
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

/** Java `ScoreChoice` record. `ordinal`은 `SCORE_CATEGORIES`의 인덱스 = enum ordinal. */
interface ScoreChoice {
  readonly category: ScoreCategory
  readonly utility: number
  readonly ordinal: number
}

/** Java `HoldChoice` record. */
interface HoldChoice {
  readonly heldCounts: readonly number[]
  readonly expectedUtility: number
  readonly kept: number
}

/** 동점이면 **뒤쪽(하단) 칸**이 이긴다(Java `ordinal() > other.ordinal()`). */
const isBetterScore = (candidate: ScoreChoice, best: ScoreChoice): boolean =>
  candidate.utility > best.utility ||
  (candidate.utility === best.utility && candidate.ordinal > best.ordinal)

/** 기대값이 같으면 **더 많이 킵하는** 쪽이 이긴다(불필요한 리롤 연출을 줄인다). */
const isBetterHold = (candidate: HoldChoice, best: HoldChoice): boolean =>
  candidate.expectedUtility > best.expectedUtility ||
  (candidate.expectedUtility === best.expectedUtility && candidate.kept > best.kept)

interface Search {
  readonly stateValue: (diceCounts: readonly number[], rerollsRemaining: number) => number
  readonly bestScore: (diceCounts: readonly number[]) => ScoreChoice
  readonly bestHold: (diceCounts: readonly number[], rerollsRemaining: number) => HoldChoice
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

  /**
   * 탐색 하나의 수명 = `decide` 호출 하나. 메모는 점수판에 의존하므로 호출 사이에
   * 공유할 수 없다(다른 플레이어·다른 라운드면 같은 주사위의 가치가 다르다).
   */
  private createSearch(board: ScoreBoard): Search {
    const openCategories = SCORE_CATEGORIES.filter(
      (category) => board.categories[category] === null,
    )
    if (openCategories.length === 0) {
      throw new BotDecisionError('AI bot has no open score category')
    }
    const evaluator = this.valueEvaluator
    const memoized = new Map<number, number>()
    const budgetMs = this.budgetMs
    const startedAt = this.now()
    const now = this.now
    const requireBudget = (): void => {
      const elapsed = now() - startedAt
      if (elapsed > budgetMs) throw new BotSearchBudgetError(budgetMs, elapsed)
    }

    const bestScore = (diceCounts: readonly number[]): ScoreChoice => {
      const dice = expand(diceCounts)
      // 스몰 스트레이트가 열려 있고 충족됐다면 초이스는 볼 필요가 없다 — 같은
      // 주사위로 15점 이상이 보장되므로 항상 지배당한다. 탐색 폭을 줄이는 순수한 pruning이다.
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
      if (best === null) {
        throw new BotDecisionError('AI bot has no open score category')
      }
      return best
    }

    /** 키를 이미 알고 있을 때의 진입점 — 메모 적중이면 배열을 만들지 않는다. */
    const valueAtKey = (
      key: number,
      diceCounts: () => readonly number[],
      rerollsRemaining: number,
    ): number => {
      const cached = memoized.get(key)
      if (cached !== undefined) return cached
      requireBudget()
      const counts = diceCounts()
      const scoreValue = bestScore(counts).utility
      const calculated =
        rerollsRemaining === 0
          ? scoreValue
          : Math.max(scoreValue, bestHold(counts, rerollsRemaining).expectedUtility)
      memoized.set(key, calculated)
      return calculated
    }

    const stateValue = (diceCounts: readonly number[], rerollsRemaining: number): number =>
      valueAtKey(
        rerollsRemaining * ENCODE_SPACE + encode(diceCounts),
        () => diceCounts,
        rerollsRemaining,
      )

    const bestHold = (diceCounts: readonly number[], rerollsRemaining: number): HoldChoice => {
      let best: HoldChoice | null = null
      const childLevel = (rerollsRemaining - 1) * ENCODE_SPACE
      for (const pattern of holdPatterns(diceCounts)) {
        const kept = pattern.reduce((sum, count) => sum + count, 0)
        const patternEncoded = encode(pattern)
        let expectedUtility = 0
        for (const outcome of OUTCOMES_BY_DICE_COUNT[DICE_COUNT - kept] ?? []) {
          expectedUtility +=
            outcome.probability *
            valueAtKey(
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

    return { stateValue, bestScore, bestHold }
  }
}
