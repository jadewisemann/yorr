import { describe, expect, it } from 'vitest'
import {
  createDiceSet,
  type HeldDice,
  isDiceSet,
  NO_HELD_DICE,
  planRoll,
  toggleHeldDie,
} from './dice'

describe('dice', () => {
  it('creates a deterministic roll plan without mutating its input', () => {
    const input = {
      requestId: 'roll-1',
      seed: 42,
      currentDice: null,
      held: NO_HELD_DICE,
    } as const

    const first = planRoll(input)
    const second = planRoll(input)

    expect(first).toEqual(second)
    expect(first.nextSeed).not.toBe(planRoll({ ...input, seed: 43 }).nextSeed)
    expect(input).toEqual({
      requestId: 'roll-1',
      seed: 42,
      currentDice: null,
      held: NO_HELD_DICE,
    })
  })

  it('keeps held positions and copies the held state into the plan', () => {
    const held: [boolean, boolean, boolean, boolean, boolean] = [true, false, true, false, true]
    const plan = planRoll({
      requestId: 'roll-2',
      seed: 99,
      currentDice: createDiceSet([1, 2, 3, 4, 5]),
      held,
    })
    held[0] = false

    expect(plan.targetDice[0]).toBe(1)
    expect(plan.targetDice[2]).toBe(3)
    expect(plan.targetDice[4]).toBe(5)
    expect(plan.held).toEqual([true, false, true, false, true])
    expect(isDiceSet(plan.targetDice)).toBe(true)
  })

  it('validates exactly five integer values from one to six', () => {
    expect(isDiceSet([1, 2, 3, 4, 5])).toBe(true)
    expect(isDiceSet([1, 2, 3, 4])).toBe(false)
    expect(isDiceSet([1, 2, 3, 4, 7])).toBe(false)
    expect(isDiceSet([1, 2, 3, 4, 5.5])).toBe(false)
    expect(() => createDiceSet([1, 2, 3, 4, 7])).toThrow(RangeError)
  })

  it('isolates a validated dice set from its mutable source', () => {
    const values = [1, 2, 3, 4, 5]
    const dice = createDiceSet(values)
    values[0] = 6

    expect(dice).toEqual([1, 2, 3, 4, 5])
  })

  it('rejects held dice before the first roll and non-finite seeds', () => {
    expect(() =>
      planRoll({
        requestId: 'invalid-hold',
        seed: 1,
        currentDice: null,
        held: [true, false, false, false, false],
      }),
    ).toThrow('Dice cannot be held before the first roll')
    expect(() =>
      planRoll({
        requestId: 'invalid-seed',
        seed: Number.NaN,
        currentDice: null,
        held: NO_HELD_DICE,
      }),
    ).toThrow(RangeError)
  })

  it('toggles one held position without changing the source tuple', () => {
    const held: HeldDice = [false, true, false, true, false]

    expect(toggleHeldDie(held, 2)).toEqual([false, true, true, true, false])
    expect(held).toEqual([false, true, false, true, false])
  })
})
