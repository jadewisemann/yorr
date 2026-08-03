export type DiceValue = 1 | 2 | 3 | 4 | 5 | 6

export type DiceSet = readonly [DiceValue, DiceValue, DiceValue, DiceValue, DiceValue]

export type HeldDice = readonly [boolean, boolean, boolean, boolean, boolean]
export type DiceIndex = 0 | 1 | 2 | 3 | 4

export const NO_HELD_DICE: HeldDice = Object.freeze([false, false, false, false, false] as const)

export interface DiceRollRequest {
  requestId: string
  seed: number
  held: HeldDice
  targetDice: DiceSet
}

export interface CreateRollRequestInput {
  requestId: string
  seed: number
  held: HeldDice
  currentDice?: DiceSet | null
  targetDice?: DiceSet
}

export function isDiceValue(value: unknown): value is DiceValue {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 6
}

export function isDiceSet(value: unknown): value is DiceSet {
  return Array.isArray(value) && value.length === 5 && value.every(isDiceValue)
}

export function createDiceSet(values: readonly number[]): DiceSet {
  if (!isDiceSet(values)) {
    throw new RangeError('DiceSet must contain exactly five integer values from 1 to 6')
  }
  return [values[0], values[1], values[2], values[3], values[4]]
}

export function toggleHeldDie(held: HeldDice, index: DiceIndex): HeldDice {
  const next: [boolean, boolean, boolean, boolean, boolean] = [...held]
  next[index] = !next[index]
  return next
}

export function createRollRequest({
  currentDice = null,
  held,
  requestId,
  seed,
  targetDice,
}: CreateRollRequestInput): DiceRollRequest {
  const normalizedSeed = normalizeSeed(seed)
  return {
    requestId,
    seed: normalizedSeed,
    held: [...held],
    targetDice: targetDice ? [...targetDice] : rollDice(normalizedSeed, held, currentDice),
  }
}

export function rollDice(seed: number, held: HeldDice, currentDice: DiceSet | null): DiceSet {
  let state = normalizeSeed(seed)
  return held.map((isHeld, index) => {
    if (isHeld && currentDice) return currentDice[index]
    state = advanceSeed(state)
    return (Math.floor((state / 2 ** 32) * 6) + 1) as DiceValue
  }) as unknown as DiceSet
}

export function nextRollSeed(seed: number) {
  return advanceSeed(normalizeSeed(seed))
}

function normalizeSeed(seed: number) {
  if (!Number.isFinite(seed)) throw new RangeError('Seed must be a finite number')
  return Math.trunc(seed) >>> 0
}

function advanceSeed(seed: number) {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
}
