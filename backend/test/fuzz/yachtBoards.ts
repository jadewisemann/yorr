import {
  createScoreBoard,
  isUpperCategory,
  SCORE_CATEGORIES,
  type ScoreBoard,
  UPPER_BONUS_SCORE,
  UPPER_BONUS_THRESHOLD,
} from '../../src/game/score/index.js'
import { YACHT_CATEGORIES, type YachtCategory } from '../oracles/yacht.js'
import { createPrng, type Prng } from './prng.js'

/**
 * 봇 테스트용 점수판 생성기. 봇은 점수판의 "정당성"(그 점수가 실제로 나올 수 있었나)을 보지
 * 않고 값만 읽으므로, 칸마다 그럴듯한 점수 하나면 된다. 상단 소계·보너스·총점만은 칸과 맞춘다.
 */
export interface NamedBoard {
  readonly name: string
  readonly board: ScoreBoard
  readonly open: readonly YachtCategory[]
}

export const boardFrom = (
  name: string,
  filled: Partial<Record<YachtCategory, number>>,
): NamedBoard => {
  const upperSubtotal = Object.entries(filled)
    .filter(([category]) => isUpperCategory(category as YachtCategory))
    .reduce((sum, [, score]) => sum + (score ?? 0), 0)
  const upperBonus = upperSubtotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0
  const total =
    Object.values(filled).reduce<number>((sum, score) => sum + (score ?? 0), 0) + upperBonus
  const board = createScoreBoard({
    categories: filled,
    upperSubtotal,
    upperBonus,
    total,
  })
  return {
    name,
    board,
    open: YACHT_CATEGORIES.filter((category) => filled[category] === undefined),
  }
}

export const plausibleScore = (category: YachtCategory, prng: Prng): number => {
  const face = SCORE_CATEGORIES.indexOf(category) + 1
  if (isUpperCategory(category)) return face * prng.int(0, 5)
  switch (category) {
    case 'smallStraight':
      return prng.chance(0.6) ? 15 : 0
    case 'largeStraight':
      return prng.chance(0.4) ? 30 : 0
    case 'yacht':
      return prng.chance(0.1) ? 50 : 0
    default:
      return prng.int(0, 30)
  }
}

/** 시드 하나로 정해지는 무작위 판. 열린 칸이 최소 하나는 남는다. */
export const randomBoard = (seed: number): NamedBoard => {
  const prng = createPrng(seed)
  const filledCount = prng.int(0, YACHT_CATEGORIES.length - 1)
  // 비교 함수 기반 sort는 전순서가 아니고 엔진 구현에 따라 PRNG 소비 순서가 달라진다 —
  // 시드 재현 계약을 지키려면 명시적인 피셔-예이츠를 쓴다.
  const shuffled = [...YACHT_CATEGORIES]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = prng.int(0, index)
    const current = shuffled[index] as YachtCategory
    shuffled[index] = shuffled[swap] as YachtCategory
    shuffled[swap] = current
  }
  const filled: Partial<Record<YachtCategory, number>> = {}
  for (const category of shuffled.slice(0, filledCount)) {
    filled[category] = plausibleScore(category, prng)
  }
  return boardFrom(`random(seed=${seed})`, filled)
}

export const randomDice = (prng: Prng): number[] => Array.from({ length: 5 }, () => prng.int(1, 6))
