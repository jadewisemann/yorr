import { oracleScore, YACHT_CATEGORIES, type YachtCategory } from './yacht.js'

/**
 * 야추 봇 정책의 **독립 구현** — 테스트 오라클이다.
 *
 * 운영 정책(`expectimaxYachtBotPolicy.ts`)은 면별 개수를 base-6로 인코딩하고, 굴림 결과를
 * 다항 분포로 묶고, 킵 후보를 부분 다중집합으로 열거한다. 이 파일은 그 어느 것도 쓰지 않는다:
 *
 * - 킵 후보 = 주사위 **자리** 5개의 부분집합 31개(비트마스크). 같은 다중집합이 여러 번 나와도 된다.
 * - 굴림 = 남은 주사위 k개의 **순서 있는** 결과 6^k개를 하나씩 센다(확률은 전부 1/6^k).
 * - 채점 = 운영 계산기가 아니라 채점 오라클(`yacht.ts`)이다.
 *
 * 공유하는 것은 **평가기 하나**다(`categoryUtility`). 평가기는 휴리스틱 그 자체라 "독립 구현"이
 * 따로 있을 수 없고, 이 오라클이 검증하는 것은 "그 평가기 아래에서 탐색이 최적인가"다.
 * 빠를 필요는 없다 — 규칙 문장을 곧이곧대로 옮기는 것이 목표다(SQLite의 SQL Logic Test와
 * 같은 발상: 다른 엔진이 같은 질의에 같은 답을 내는지 대조한다).
 *
 * 규칙(정책 주석과 docs/design/games/yacht.md 「봇 스택」이 정본이다):
 * 1. 마지막 굴림(rollCount 3)이면 효용이 가장 큰 칸에 기록한다. 동점이면 **뒤쪽 칸**.
 * 2. 그 전에는 "지금 기록"과 "최선의 킵 → 남은 굴림의 기대값"을 비교한다. 기록의 효용 + 0.15가
 *    킵의 기대값 이상이면 기록, 아니면 킵이다.
 * 3. 상태의 가치 = max(지금 기록, 최선의 킵). 2번의 0.15는 **최상위 결정에만** 쓴다.
 * 4. 다섯 개를 전부 킵하는 것은 후보가 아니다(그것은 "기록"으로 표현된다).
 * 5. 스몰 스트레이트가 열려 있고 이 주사위가 그것을 충족하면 **초이스는 후보가 아니다.**
 *    평가기만으로는 초이스가 이길 때가 있지만 초이스를 버림 칸으로 아끼는 것이 이 봇의 규칙이다.
 *    가치 계산(규칙 3)에도 똑같이 적용된다.
 */

/** 오라클이 평가기에 바라는 것. 운영 `ScorecardValueEvaluator`가 구조적으로 만족한다. */
export interface OracleEvaluator<Board> {
  categoryUtility(board: Board, category: YachtCategory, score: number): number
}

export const EARLY_SCORE_MARGIN = 0.15
const MAX_ROLL_COUNT = 3
const FACES = [1, 2, 3, 4, 5, 6] as const

export interface OracleScoreChoice {
  readonly category: YachtCategory
  readonly utility: number
}

export interface OracleAnalysis {
  /** 지금 기록할 때의 최선(동점이면 뒤쪽 칸). */
  readonly score: OracleScoreChoice
  /** 최선의 킵 기대값. 마지막 굴림이면 null. */
  readonly holdValue: number | null
  /** 킵한 다중집합(정렬) → 그 킵의 기대값. 마지막 굴림이면 비어 있다. */
  readonly holdValues: ReadonlyMap<string, number>
  /** 규칙 2로 고른 행동. */
  readonly action: 'SCORE' | 'HOLD'
}

const sorted = (dice: readonly number[]): number[] => [...dice].sort((left, right) => left - right)
const keyOf = (dice: readonly number[]): string => sorted(dice).join('')

function* orderedRolls(count: number): Generator<number[]> {
  if (count === 0) {
    yield []
    return
  }
  for (const face of FACES) for (const rest of orderedRolls(count - 1)) yield [face, ...rest]
}

export class YachtBotOracle<Board> {
  private readonly open: readonly YachtCategory[]
  private readonly values = new Map<string, number>()
  private readonly expectations = new Map<string, number>()

  constructor(
    private readonly board: Board,
    openCategories: readonly YachtCategory[],
    private readonly evaluator: OracleEvaluator<Board>,
  ) {
    if (openCategories.length === 0) throw new Error('열린 칸이 없다')
    // 동점 규칙("뒤쪽 칸")을 위해 룰북 순서를 지킨다.
    this.open = YACHT_CATEGORIES.filter((category) => openCategories.includes(category))
  }

  bestScore(dice: readonly number[]): OracleScoreChoice {
    const choiceExcluded =
      this.open.includes('smallStraight') && oracleScore('smallStraight', dice) > 0
    let best: OracleScoreChoice | null = null
    for (const category of this.open) {
      if (category === 'choice' && choiceExcluded) continue
      const utility = this.evaluator.categoryUtility(
        this.board,
        category,
        oracleScore(category, dice),
      )
      // `>=` = 동점이면 나중에 본(뒤쪽) 칸이 이긴다.
      if (best === null || utility >= best.utility) best = { category, utility }
    }
    return best as OracleScoreChoice
  }

  /** 주사위가 이것이고 리롤이 `rerolls`번 남았을 때의 가치(규칙 3). */
  value(dice: readonly number[], rerolls: number): number {
    const key = `${rerolls}:${keyOf(dice)}`
    const cached = this.values.get(key)
    if (cached !== undefined) return cached
    let best = this.bestScore(dice).utility
    if (rerolls > 0) {
      for (const expected of this.holds(dice, rerolls).values()) best = Math.max(best, expected)
    }
    this.values.set(key, best)
    return best
  }

  /** `held`를 남기고 나머지를 굴린 뒤 리롤이 `rerollsAfter`번 남는 기대값. */
  expectation(held: readonly number[], rerollsAfter: number): number {
    const key = `${rerollsAfter}:${keyOf(held)}`
    const cached = this.expectations.get(key)
    if (cached !== undefined) return cached
    let total = 0
    let count = 0
    for (const roll of orderedRolls(5 - held.length)) {
      total += this.value([...held, ...roll], rerollsAfter)
      count += 1
    }
    const expected = total / count
    this.expectations.set(key, expected)
    return expected
  }

  /** 자리 부분집합 31개(전부 킵 제외)마다의 기대값. 키는 킵한 다중집합. */
  holds(dice: readonly number[], rerolls: number): Map<string, number> {
    const result = new Map<string, number>()
    for (let mask = 0; mask < 31; mask += 1) {
      const held = dice.filter((_, index) => (mask & (1 << index)) !== 0)
      result.set(keyOf(held), this.expectation(held, rerolls - 1))
    }
    return result
  }

  analyze(dice: readonly number[], rollCount: number): OracleAnalysis {
    const score = this.bestScore(dice)
    if (rollCount === MAX_ROLL_COUNT) {
      return { score, holdValue: null, holdValues: new Map(), action: 'SCORE' }
    }
    const holdValues = this.holds(dice, MAX_ROLL_COUNT - rollCount)
    const holdValue = Math.max(...holdValues.values())
    const action = score.utility + EARLY_SCORE_MARGIN >= holdValue ? 'SCORE' : 'HOLD'
    return { score, holdValue, holdValues, action }
  }
}

/** 정렬된 주사위 다중집합 252개 전부. */
export const everyDiceMultiset = (): number[][] => {
  const result: number[][] = []
  const walk = (start: number, dice: number[]): void => {
    if (dice.length === 5) {
      result.push([...dice])
      return
    }
    for (let face = start; face <= 6; face += 1) walk(face, [...dice, face])
  }
  walk(1, [])
  return result
}
