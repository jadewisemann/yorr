import { describe, expect, it } from 'vitest'
import {
  createDiceSet,
  createRollRequest,
  type HeldDice,
  isDiceSet,
  NO_HELD_DICE,
  nextRollSeed,
  toggleHeldDie,
} from './dice'

describe('dice', () => {
  it('creates roll metadata without planning dice values', () => {
    const input = {
      requestId: 'roll-1',
      seed: 42,
      held: NO_HELD_DICE,
    } as const

    const request = createRollRequest(input)

    expect(request).toEqual({ requestId: 'roll-1', seed: 42, held: NO_HELD_DICE })
    expect(request).not.toHaveProperty('targetDice')
    expect(nextRollSeed(request.seed)).not.toBe(request.seed)
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

  it('rejects non-finite seeds', () => {
    expect(() =>
      createRollRequest({
        requestId: 'invalid-seed',
        seed: Number.NaN,
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
