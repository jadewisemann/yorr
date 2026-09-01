import { ScoreDomainError } from './scoreErrors.js'

/**
 * 야추 족보 12종.
 *
 * 와이어·Redis 필드·조회 REST 응답 키가 전부 같은 키(`ones`…)라 **그 키 자체를
 * 식별자로** 쓴다. 별도의 상수 이름 체계를 두면 어디에도 노출되지 않는 이름을
 * 하나 더 관리하게 된다.
 *
 * 순서가 계약인 곳이 셋이다: ① 점수판 12키의 직렬화 순서(2.9),
 * ② 상단 카테고리 판정(앞 6개), ③ 타임아웃 시 서버가 대신 기록할 칸을 고르는
 * `openCategories`의 열거 순서(랜덤 선택이 재현 가능해야 한다).
 *
 * ⚠️ `game/round/roundSubmission.ts`의 `SUBMITTABLE_CATEGORIES`가 같은 목록을
 * **따로** 들고 있다(라운드 → 점수 의존을 만들지 않는 경계를
 * 옮긴 것). 두 목록이 갈라지지 않는지는 `__tests__/scoreCategory.test.ts`가 지킨다.
 */
export const SCORE_CATEGORIES = [
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

export type ScoreCategory = (typeof SCORE_CATEGORIES)[number]

/** 상단(에이스~식스) — 보너스 63의 대상이다. */
export const UPPER_CATEGORIES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const

export type UpperScoreCategory = (typeof UPPER_CATEGORIES)[number]

const UPPER_CATEGORY_SET: ReadonlySet<string> = new Set(UPPER_CATEGORIES)
const CATEGORY_SET: ReadonlySet<string> = new Set(SCORE_CATEGORIES)

/** 상단 카테고리가 세는 주사위 눈. */
const UPPER_FACE: Readonly<Record<UpperScoreCategory, number>> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
}

export interface ScoreCategoryInfo {
  readonly label: string
  readonly description: string
}

/** 표시용 문자열. 서버 로직은 쓰지 않지만 계약의 일부다. */
export const SCORE_CATEGORY_INFO: Readonly<Record<ScoreCategory, ScoreCategoryInfo>> =
  Object.freeze({
    ones: { label: '에이스', description: '1의 합' },
    twos: { label: '듀스', description: '2의 합' },
    threes: { label: '트레이', description: '3의 합' },
    fours: { label: '포', description: '4의 합' },
    fives: { label: '파이브', description: '5의 합' },
    sixes: { label: '식스', description: '6의 합' },
    choice: { label: '초이스', description: '모든 주사위의 합' },
    fourOfAKind: { label: '포커', description: '같은 눈 4개 이상' },
    fullHouse: { label: '풀하우스', description: '같은 눈 3개와 2개' },
    smallStraight: { label: '스몰 스트레이트', description: '연속된 눈 4개' },
    largeStraight: { label: '라지 스트레이트', description: '연속된 눈 5개' },
    yacht: { label: '요트', description: '같은 눈 5개' },
  })

export const DICE_COUNT = 5
const MIN_FACE = 1
const MAX_FACE = 6

export const isScoreCategory = (value: unknown): value is ScoreCategory =>
  typeof value === 'string' && CATEGORY_SET.has(value)

export const isUpperCategory = (category: ScoreCategory): category is UpperScoreCategory =>
  UPPER_CATEGORY_SET.has(category)

/** 모르는 키는 던진다(상위가 INVALID_CATEGORY로 옮긴다). */
export const scoreCategoryOf = (apiKey: string): ScoreCategory => {
  if (!isScoreCategory(apiKey)) {
    throw new ScoreDomainError(`지원하지 않는 점수 카테고리입니다: ${apiKey}`)
  }
  return apiKey
}

/** 주사위 검증 — 5개·1~6. 검증 실패는 "0점"이 아니라 **예외**다. */
const validateDice = (dice: readonly number[]): void => {
  if (dice === null || dice === undefined || !Array.isArray(dice)) {
    throw new ScoreDomainError('주사위는 null일 수 없습니다.')
  }
  if (dice.length !== DICE_COUNT) {
    throw new ScoreDomainError('주사위는 정확히 5개여야 합니다.')
  }
  if (dice.some((die) => !Number.isInteger(die) || die < MIN_FACE || die > MAX_FACE)) {
    throw new ScoreDomainError('주사위 눈은 1부터 6 사이여야 합니다.')
  }
}

const counts = (dice: readonly number[]): Map<number, number> => {
  const result = new Map<number, number>()
  for (const die of dice) result.set(die, (result.get(die) ?? 0) + 1)
  return result
}

const containsFace = (dice: readonly number[], face: number): boolean => dice.includes(face)

const isFourOfAKind = (dice: readonly number[]): boolean =>
  [...counts(dice).values()].some((count) => count >= 4)

/** 5개 동일은 **불충족**이다(정확히 2 + 3). 의도된 판정이자 계약이다. */
const isFullHouse = (dice: readonly number[]): boolean => {
  const values = [...counts(dice).values()]
  return values.length === 2 && values.includes(2) && values.includes(3)
}

/** 중복을 무시하고 연속한 눈이 `length`개 이상인지. */
const hasRun = (dice: readonly number[], length: number): boolean => {
  const faces = new Set(dice)
  let run = 0
  for (let face = MIN_FACE; face <= MAX_FACE; face += 1) {
    run = faces.has(face) ? run + 1 : 0
    if (run >= length) return true
  }
  return false
}

/** 족보 충족 여부. 주사위가 유효하지 않으면 던진다(순서에는 무관). */
export const isSatisfiedBy = (category: ScoreCategory, dice: readonly number[]): boolean => {
  validateDice(dice)
  switch (category) {
    case 'ones':
    case 'twos':
    case 'threes':
    case 'fours':
    case 'fives':
    case 'sixes':
      return containsFace(dice, UPPER_FACE[category])
    case 'choice':
      return true
    case 'fourOfAKind':
      return isFourOfAKind(dice)
    case 'fullHouse':
      return isFullHouse(dice)
    case 'smallStraight':
      return hasRun(dice, 4)
    case 'largeStraight':
      return hasRun(dice, 5)
    case 'yacht':
      return counts(dice).size === 1
  }
}

/** 상단 카테고리가 세는 눈의 합. */
export const upperFaceSum = (category: UpperScoreCategory, dice: readonly number[]): number => {
  const face = UPPER_FACE[category]
  return dice.filter((die) => die === face).reduce((sum, die) => sum + die, 0)
}
