import { RoundSynchronizationError } from './roundErrors.js'

export const DICE_COUNT = 5
const MIN_DIE_VALUE = 1
const MAX_DIE_VALUE = 6

/**
 * 제출 가능한 카테고리 이름.
 *
 * 점수 도메인의 `ScoreCategory`를 참조하지 않고 **문자열 집합을 따로 든다.**
 * 라운드 도메인이 점수 도메인을 모르게 하는 경계다 — 대신 두 목록의 순서와
 * 철자가 같아야 한다.
 */
export const SUBMITTABLE_CATEGORIES = [
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

export type SubmittableCategory = (typeof SUBMITTABLE_CATEGORIES)[number]

const CATEGORY_SET: ReadonlySet<string> = new Set(SUBMITTABLE_CATEGORIES)

const isInvalidDie = (die: number | undefined): boolean =>
  die === undefined || !Number.isInteger(die) || die < MIN_DIE_VALUE || die > MAX_DIE_VALUE

/**
 * 한 플레이어의 라운드 제출. **생성 자체가 검증 지점**이라 잘못된 제출은
 * 도메인 안으로 들어오지 못한다.
 *
 * `dice`는 방어적으로 복사해 얼린다. 호출부가 넘긴 배열을
 * 나중에 바꿔도 제출 내용은 변하지 않는다.
 */
export class RoundSubmission {
  readonly playerId: string
  readonly roundNumber: number
  readonly dice: readonly number[]
  readonly category: SubmittableCategory

  constructor(playerId: string, roundNumber: number, dice: readonly number[], category: string) {
    if (playerId.trim().length === 0) {
      throw new RoundSynchronizationError('INVALID_PLAYER', 'playerId must not be blank')
    }
    if (roundNumber < 1) {
      throw new RoundSynchronizationError('INVALID_ROUND', 'roundNumber must be at least 1')
    }
    if (dice.length !== DICE_COUNT || dice.some(isInvalidDie)) {
      throw new RoundSynchronizationError(
        'INVALID_DICE',
        'dice must contain exactly five values between 1 and 6',
      )
    }
    if (!CATEGORY_SET.has(category)) {
      throw new RoundSynchronizationError('INVALID_CATEGORY', `unsupported category: ${category}`)
    }

    this.playerId = playerId
    this.roundNumber = roundNumber
    this.dice = Object.freeze([...dice])
    this.category = category as SubmittableCategory
  }
}
