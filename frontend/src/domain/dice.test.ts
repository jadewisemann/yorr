import { describe, expect, it } from 'vitest'
import {
  createDiceSet,
  createRollRequest,
  type HeldDice,
  isDiceSet,
  NO_HELD_DICE,
  nextRollSeed,
  rollDice,
  toggleHeldDie,
} from './dice'

describe('dice', () => {
  it('plans target dice deterministically from the seed at request time', () => {
    const input = {
      requestId: 'roll-1',
      seed: 42,
      held: NO_HELD_DICE,
      currentDice: null,
    } as const

    const request = createRollRequest(input)

    expect(request.requestId).toBe('roll-1')
    expect(request.seed).toBe(42)
    expect(request.held).toEqual(NO_HELD_DICE)
    expect(isDiceSet(request.targetDice)).toBe(true)
    expect(request.targetDice).toEqual(createRollRequest(input).targetDice)
    expect(nextRollSeed(request.seed)).not.toBe(request.seed)
  })

  it('keeps held dice values and rerolls only the rest', () => {
    const held: HeldDice = [true, false, true, false, false]
    const current = createDiceSet([6, 1, 3, 1, 1])

    const target = rollDice(42, held, current)

    expect(target[0]).toBe(6)
    expect(target[2]).toBe(3)
    expect(isDiceSet(target)).toBe(true)
  })

  it('honors an explicit target dice override', () => {
    const target = createDiceSet([6, 6, 6, 6, 6])

    const request = createRollRequest({
      requestId: 'roll-forced',
      seed: 42,
      held: NO_HELD_DICE,
      currentDice: null,
      targetDice: target,
    })

    expect(request.targetDice).toEqual(target)
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
        currentDice: null,
      }),
    ).toThrow(RangeError)
  })

  it('toggles one held position without changing the source tuple', () => {
    const held: HeldDice = [false, true, false, true, false]

    expect(toggleHeldDie(held, 2)).toEqual([false, true, true, true, false])
    expect(held).toEqual([false, true, false, true, false])
  })
})
