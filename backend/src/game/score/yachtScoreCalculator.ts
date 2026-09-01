import {
  isSatisfiedBy,
  isScoreCategory,
  type ScoreCategory,
  UPPER_CATEGORIES,
  upperFaceSum,
} from './scoreCategory.js'
import { ScoreDomainError } from './scoreErrors.js'

/**
 * 야추 채점의 **유일한 권위** — 순수 함수 묶음이다.
 *
 * 클라이언트가 보낸 점수는 와이어에 존재하지도 않는다. `round.submit`은
 * {roundNumber, dice, category}만 싣고 점수는 서버가 여기서 다시 만든다
 * (DESIGN.md 원칙 1 — 서버 권위).
 */
const SMALL_STRAIGHT_SCORE = 15
const LARGE_STRAIGHT_SCORE = 30
const YACHT_SCORE = 50
export const UPPER_BONUS_THRESHOLD = 63
export const UPPER_BONUS_SCORE = 35

const sum = (dice: readonly number[]): number => dice.reduce((total, die) => total + die, 0)

/** 족보가 불충족이면 **0점**(= 그 칸을 희생한 것). 잘못된 주사위는 예외다. */
export const calculateScore = (category: ScoreCategory, dice: readonly number[]): number => {
  if (!isScoreCategory(category)) {
    throw new ScoreDomainError('점수 카테고리는 null일 수 없습니다.')
  }
  if (!isSatisfiedBy(category, dice)) return 0

  switch (category) {
    case 'ones':
    case 'twos':
    case 'threes':
    case 'fours':
    case 'fives':
    case 'sixes':
      return upperFaceSum(category, dice)
    // choice·fourOfAKind·fullHouse는 전부 "주사위 전체 합"이다.
    case 'choice':
    case 'fourOfAKind':
    case 'fullHouse':
      return sum(dice)
    case 'smallStraight':
      return SMALL_STRAIGHT_SCORE
    case 'largeStraight':
      return LARGE_STRAIGHT_SCORE
    case 'yacht':
      return YACHT_SCORE
  }
}

/**
 * 상단 소계. **기록하지 않은 칸(키 없음)은 0으로 세고, 값이 null이거나 음수면
 * 던진다** — 미기록(null)과 무득점(0)의 구분을 계산기까지 끌고 가지 않되,
 * 손상된 값을 조용히 넘기지 않는다.
 */
export const calculateUpperSubtotal = (
  scores: ReadonlyMap<ScoreCategory, number | null | undefined>,
): number => {
  if (!(scores instanceof Map)) {
    throw new ScoreDomainError('카테고리별 점수는 null일 수 없습니다.')
  }
  let subtotal = 0
  for (const category of UPPER_CATEGORIES) {
    if (!scores.has(category)) continue
    const score = scores.get(category)
    if (score === null || score === undefined || score < 0) {
      throw new ScoreDomainError('상단 카테고리 점수는 0 이상이어야 합니다.')
    }
    subtotal += score
  }
  return subtotal
}

/** 상단 소계 63 이상이면 35점. 경계는 **이상**이다(63 포함). */
export const calculateUpperBonus = (
  scores: ReadonlyMap<ScoreCategory, number | null | undefined>,
): number => (calculateUpperSubtotal(scores) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0)

/** 편의 — 카테고리 하나가 상단인지. 재-export라 호출부가 두 모듈을 열지 않아도 된다. */
