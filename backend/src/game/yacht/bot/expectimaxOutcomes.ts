import { DICE_COUNT } from '../../score/index.js'

/**
 * expectimax 확률 노드의 **결과 분포** — 주사위 n개를 굴렸을 때 나올 수 있는
 * 면 조합과 그 정확한 확률.
 *
 * 샘플링이 아니라 다항 분포의 정확 계산이다 — 같은 상태에서 같은 답이 나오는 것이
 * 재현·테스트의 전제다. 조합을 세는 일(counts 조작)은 `expectimaxDiceMath.ts`가 맡고,
 * 여기는 "그 조합이 얼마나 자주 나오는가"만 안다.
 */

export const FACE_COUNT = 6
export const MAX_ROLL_COUNT = 3
/** counts 인코딩의 자리수(면당 0..5 → base 6). `6^6`이 키 공간의 상한이다. */
export const ENCODE_BASE = DICE_COUNT + 1
export const ENCODE_SPACE = ENCODE_BASE ** FACE_COUNT

export interface DiceOutcome {
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
export const encode = (counts: readonly number[]): number => {
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
 * 총 1+6+21+56+126+252 = 462개로, 방마다 다시 만들 이유가 없다.
 */
export const OUTCOMES_BY_DICE_COUNT: readonly (readonly DiceOutcome[])[] = (() => {
  const table: DiceOutcome[][] = []
  for (let diceCount = 0; diceCount <= DICE_COUNT; diceCount += 1) {
    const outcomes: DiceOutcome[] = []
    collectOutcomes(diceCount, 0, new Array<number>(FACE_COUNT).fill(0), outcomes)
    table.push(outcomes)
  }
  return table
})()
