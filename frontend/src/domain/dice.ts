export type DiceValue = 1 | 2 | 3 | 4 | 5 | 6

export type DiceSet = readonly [DiceValue, DiceValue, DiceValue, DiceValue, DiceValue]

export type HeldDice = readonly [boolean, boolean, boolean, boolean, boolean]
export type DiceIndex = 0 | 1 | 2 | 3 | 4

export const NO_HELD_DICE: HeldDice = Object.freeze([false, false, false, false, false] as const)

export interface RollPlan {
  requestId: string
  seed: number
  nextSeed: number
  targetDice: DiceSet
  held: HeldDice
}

export interface PlanRollInput {
  requestId: string
  seed: number
  currentDice: DiceSet | null
  held: HeldDice
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

export function planRoll({ currentDice, held, requestId, seed }: PlanRollInput): RollPlan {
  if (!currentDice && held.some(Boolean)) {
    throw new Error('Dice cannot be held before the first roll')
  }

  let nextSeed = normalizeSeed(seed)
  const values: number[] = []

  for (let index = 0; index < 5; index += 1) {
    const heldValue = currentDice?.[index]
    if (held[index] && heldValue !== undefined) {
      values.push(heldValue)
      continue
    }

    nextSeed = advanceSeed(nextSeed)
    values.push(Math.floor((nextSeed / 2 ** 32) * 6) + 1)
  }

  return {
    requestId,
    seed: normalizeSeed(seed),
    nextSeed,
    targetDice: createDiceSet(values),
    held: [...held],
  }
}

function normalizeSeed(seed: number) {
  if (!Number.isFinite(seed)) throw new RangeError('Seed must be a finite number')
  return Math.trunc(seed) >>> 0
}

function advanceSeed(seed: number) {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
}
