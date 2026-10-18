import {
  createScoreBoard,
  isUpperCategory,
  SCORE_CATEGORIES,
  type ScoreBoard,
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
  const total = Object.values(filled).reduce<number>((sum, score) => sum + (score ?? 0), 0)
  const board = createScoreBoard(filled, upperSubtotal, upperSubtotal >= 63 ? 35 : 0, total)
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
  const filledCount = prng.int(0, 11)
  const shuffled = [...YACHT_CATEGORIES].sort(() => prng.next() - 0.5)
  const filled: Partial<Record<YachtCategory, number>> = {}
  for (const category of shuffled.slice(0, filledCount)) {
    filled[category] = plausibleScore(category, prng)
  }
  return boardFrom(`random(seed=${seed})`, filled)
}

export const randomDice = (prng: Prng): number[] => Array.from({ length: 5 }, () => prng.int(1, 6))
