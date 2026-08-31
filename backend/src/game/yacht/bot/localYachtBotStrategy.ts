import { calculateScore, DICE_COUNT, type ScoreCategory } from '../../score/index.js'
import { BotDecisionError } from './botErrors.js'

/**
 * Expectimax가 실패했을 때의 **폴백 정책**.
 *
 * 탐색이 없다. 규칙 두 줄이다: ① 4연속 창에서 3면 이상 모였으면 스트레이트를 잡는다
 * ② 아니면 최빈 면을 잡는다(전부 단독이면 5·6만). 카테고리는 점수 최대 + 고정
 * 선호 타이브레이크.
 *
 * 이 정책이 "덜 똑똑한 봇"으로 쓰이는 경로는 없다 — 폴백 전용이다.
 */

/**
 * 점수가 같을 때의 고정 선호. **인덱스가 아니라 손으로 정한 순서**다(아래
 * switch 그대로): 희소한 족보를 아껴 쓰는 것보다 지금 쓰는 쪽에 값을 준다.
 */
const TIE_BREAK: Readonly<Record<ScoreCategory, number>> = Object.freeze({
  yacht: 12,
  largeStraight: 11,
  fourOfAKind: 10,
  fullHouse: 9,
  choice: 8,
  smallStraight: 7,
  sixes: 6,
  fives: 5,
  fours: 4,
  threes: 3,
  twos: 2,
  ones: 1,
})

/** 최빈 면이 단독일 때 "그래도 잡을 만한" 하한. */
const HIGH_FACE = 5

const requireDice = (dice: readonly number[]): void => {
  if (
    !Array.isArray(dice) ||
    dice.length !== DICE_COUNT ||
    dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6)
  ) {
    throw new BotDecisionError('exactly five dice between 1 and 6 are required')
  }
}

const counts = (dice: readonly number[]): Map<number, number> => {
  const result = new Map<number, number>()
  for (const die of dice) result.set(die, (result.get(die) ?? 0) + 1)
  return result
}

/**
 * 가장 긴 4연속 창(1-4 / 2-5 / 3-6)에 들어 있는 **서로 다른** 면들.
 * 동률이면 낮은 창이 이긴다.
 */
const bestStraightWindow = (dice: readonly number[]): number[] => {
  let best: number[] = []
  for (let start = 1; start <= 3; start += 1) {
    const window: number[] = []
    for (let face = start; face < start + 4; face += 1) {
      if (dice.includes(face)) window.push(face)
    }
    if (window.length > best.length) best = window
  }
  return best
}

/**
 * 최빈 면을 잡는다. 동률이면 **높은 면**이 이긴다. 전부 단독이면(최빈 개수 1)
 * 잡을 페어가 없으므로 5·6만 남긴다.
 */
const keepMostFrequentOrHigh = (dice: readonly number[]): boolean[] => {
  const byFace = counts(dice)
  let target = 0
  let targetCount = 0
  for (const [face, count] of byFace) {
    if (count > targetCount || (count === targetCount && face > target)) {
      target = face
      targetCount = count
    }
  }
  if (targetCount === 1) return dice.map((die) => die >= HIGH_FACE)
  return dice.map((die) => die === target)
}

export class LocalYachtBotStrategy {
  /** 다시 굴리지 않을 자리. 5개 전부 true면 호출부는 "제출"로 해석한다. */
  chooseHeld(dice: readonly number[]): boolean[] {
    requireDice(dice)
    const window = bestStraightWindow(dice)
    if (window.length >= 3) {
      // 같은 면이 두 개 있으면 **하나만** 남긴다(스트레이트에 중복은 쓸모가 없다).
      const remaining = [...window]
      return dice.map((die) => {
        const index = remaining.indexOf(die)
        if (index === -1) return false
        remaining.splice(index, 1)
        return true
      })
    }
    return keepMostFrequentOrHigh(dice)
  }

  /** 열린 칸 중 점수가 가장 높은 것. 동점은 {@link TIE_BREAK}로 결정론적으로 깨진다. */
  chooseCategory(dice: readonly number[], openCategories: readonly ScoreCategory[]): ScoreCategory {
    requireDice(dice)
    if (openCategories === null || openCategories === undefined || openCategories.length === 0) {
      throw new BotDecisionError('at least one open category is required')
    }

    let best: ScoreCategory | null = null
    let bestScore = 0
    let bestTieBreak = 0
    for (const category of openCategories) {
      const score = calculateScore(category, dice)
      const tieBreak = TIE_BREAK[category]
      if (best === null || score > bestScore || (score === bestScore && tieBreak > bestTieBreak)) {
        best = category
        bestScore = score
        bestTieBreak = tieBreak
      }
    }
    // openCategories가 비어 있지 않으므로 도달할 수 없다(타입 좁히기용).
    if (best === null) throw new BotDecisionError('at least one open category is required')
    return best
  }
}
