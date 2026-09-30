/**
 * 재현 가능한 난수 — 퍼저와 속성 테스트가 쓴다.
 *
 * 규약은 SQLite 퍼저와 같다: **실패하면 시드를 찍고, 그 시드로 똑같이 다시 돌릴 수
 * 있어야 한다.** 그래서 `Math.random`을 쓰지 않고 시드 하나에서 모든 선택이 나온다.
 * 알고리즘은 mulberry32다(32비트 상태, 빠르고 분포가 테스트 용도로 충분하다 —
 * `roundSynchronizationService.seededDieRoller`와 같은 것).
 */
export interface Prng {
  readonly seed: number
  /** [0, 1) */
  next(): number
  /** 양 끝 포함 정수. */
  int(minInclusive: number, maxInclusive: number): number
  pick<T>(items: readonly T[]): T
  chance(probability: number): boolean
}

export const createPrng = (seed: number): Prng => {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
  const int = (minInclusive: number, maxInclusive: number): number =>
    minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1))
  return {
    seed: seed >>> 0,
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('빈 목록에서는 고를 수 없다')
      return items[int(0, items.length - 1)] as T
    },
    chance: (probability) => next() < probability,
  }
}

const integerFromEnv = (name: string): number | undefined => {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return undefined
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name}는 0 이상의 정수여야 한다: ${raw}`)
  }
  return parsed
}

/** `FUZZ_SEED`가 있으면 그 값, 없으면 새로 뽑는다. 뽑은 값은 반드시 테스트 이름에 싣는다. */
export const seedFromEnv = (name = 'FUZZ_SEED'): number =>
  integerFromEnv(name) ?? Math.floor(Math.random() * 2 ** 32)

/** PR에서는 짧게, 야간 실행에서는 길게 — 같은 테스트를 반복 횟수만 바꿔 돌린다. */
export const iterationsFromEnv = (name: string, fallback: number): number =>
  integerFromEnv(name) ?? fallback
