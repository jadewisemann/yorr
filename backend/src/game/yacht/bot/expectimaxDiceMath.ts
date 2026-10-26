import { DICE_COUNT } from '../../score/index.js'
import { FACE_COUNT } from './expectimaxOutcomes.js'

/**
 * expectimax 탐색이 쓰는 **주사위 조합 조작** — counts 배열을 만들고 더하고 펴는
 * 순수 정수 연산만 모은 파일.
 *
 * 결과 분포(확률)는 `expectimaxOutcomes.ts`가 정본이다. 여기는 점수판도 확률도
 * 모르고 "이 조합이 무엇인가"만 다룬다.
 */

/** 리롤 횟수를 세는 상한. 3이면 더 굴릴 수 없다. */
export const MAX_ROLL_COUNT = 3

export const countsOf = (dice: readonly number[]): number[] => {
  const counts = new Array<number>(FACE_COUNT).fill(0)
  for (const die of dice) counts[die - 1] = (counts[die - 1] ?? 0) + 1
  return counts
}

export const addCounts = (first: readonly number[], second: readonly number[]): number[] => {
  const result = new Array<number>(FACE_COUNT)
  for (let index = 0; index < FACE_COUNT; index += 1) {
    result[index] = (first[index] ?? 0) + (second[index] ?? 0)
  }
  return result
}

/** counts → 오름차순 주사위 5개. 채점은 순서에 무관하므로 정렬 형태로 충분하다. */
export const expand = (counts: readonly number[]): number[] => {
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
export const holdPatterns = (diceCounts: readonly number[]): number[][] => {
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
export const toHeldFlags = (dice: readonly number[], heldCounts: readonly number[]): boolean[] => {
  const remaining = [...heldCounts]
  return dice.map((die) => {
    const held = (remaining[die - 1] ?? 0) > 0
    if (held) remaining[die - 1] = (remaining[die - 1] ?? 0) - 1
    return held
  })
}
