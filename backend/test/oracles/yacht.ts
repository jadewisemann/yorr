/**
 * 야추 점수 규칙의 **독립 구현** — 테스트 오라클이다.
 *
 * 프론트(`frontend/src/yacht/domain/scoring.ts`)와 서버(`game/score/yachtScoreCalculator.ts`)는
 * 서로 다른 알고리즘으로 같은 규칙을 구현한다. 이 파일은 셋째 구현이며, 규칙 문장
 * (`frontend/docs/llmwiki/yacht.md`)을 가장 곧이곧대로 옮기는 것이 목표다 — 빠를 필요는
 * 없다. 세 구현이 모든 입력에서 같은 답을 내는지 보는 것이 차등 테스트다(SQLite가 다른
 * 엔진과 같은 질의 결과를 대조하는 SQL Logic Test와 같은 발상).
 */
export const YACHT_CATEGORIES = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'choice',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
] as const

export type YachtCategory = (typeof YACHT_CATEGORIES)[number]

const UPPER_FACES: Readonly<Partial<Record<YachtCategory, number>>> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
}

export const UPPER_BONUS_THRESHOLD = 63
export const UPPER_BONUS = 35

const sum = (dice: readonly number[]): number => dice.reduce((total, die) => total + die, 0)

const countOf = (dice: readonly number[], face: number): number =>
  dice.filter((die) => die === face).length

/** 눈마다 몇 개인지, 나온 눈만. 예: [2,2,5,5,5] → [2,3] (정렬됨). */
const groupSizes = (dice: readonly number[]): number[] =>
  [1, 2, 3, 4, 5, 6]
    .map((face) => countOf(dice, face))
    .filter((count) => count > 0)
    .sort((left, right) => left - right)

/** `start`부터 `length`개의 연속한 눈이 모두 있는가. */
const hasRunFrom = (dice: readonly number[], start: number, length: number): boolean =>
  Array.from({ length }, (_, offset) => start + offset).every((face) => dice.includes(face))

const hasRun = (dice: readonly number[], length: number): boolean =>
  Array.from({ length: 7 - length }, (_, index) => index + 1).some((start) =>
    hasRunFrom(dice, start, length),
  )

export const oracleScore = (category: YachtCategory, dice: readonly number[]): number => {
  const face = UPPER_FACES[category]
  if (face !== undefined) return face * countOf(dice, face)
  const sizes = groupSizes(dice)
  switch (category) {
    case 'choice':
      return sum(dice)
    case 'fourOfAKind':
      return sizes.some((size) => size >= 4) ? sum(dice) : 0
    case 'fullHouse':
      return sizes.length === 2 && sizes[0] === 2 && sizes[1] === 3 ? sum(dice) : 0
    case 'smallStraight':
      return hasRun(dice, 4) ? 15 : 0
    case 'largeStraight':
      return hasRun(dice, 5) ? 30 : 0
    case 'yacht':
      return sizes.length === 1 ? 50 : 0
    default:
      throw new Error(`상단 칸은 위에서 처리했다: ${category}`)
  }
}

export interface OracleSheet {
  readonly categories: Readonly<Record<YachtCategory, number | null>>
  readonly upperSubtotal: number
  readonly upperBonus: number
  readonly total: number
}

/** 기록된 칸들로 점수판 전체를 다시 계산한다. 기록하지 않은 칸은 null이다. */
export const oracleSheet = (
  recorded: Readonly<Partial<Record<YachtCategory, number>>>,
): OracleSheet => {
  const categories = Object.fromEntries(
    YACHT_CATEGORIES.map((category) => [category, recorded[category] ?? null]),
  ) as Record<YachtCategory, number | null>
  const upperSubtotal = YACHT_CATEGORIES.filter((category) => UPPER_FACES[category] !== undefined)
    .map((category) => categories[category] ?? 0)
    .reduce((total, score) => total + score, 0)
  const upperBonus = upperSubtotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0
  const recordedTotal = Object.values(categories).reduce<number>(
    (total, score) => total + (score ?? 0),
    0,
  )
  return { categories, upperSubtotal, upperBonus, total: recordedTotal + upperBonus }
}

/** 순서 있는 주사위 5개의 모든 조합(6^5 = 7,776). */
export function* everyDiceRoll(): Generator<readonly number[]> {
  const faces = [1, 2, 3, 4, 5, 6]
  for (const a of faces)
    for (const b of faces)
      for (const c of faces) for (const d of faces) for (const e of faces) yield [a, b, c, d, e]
}
