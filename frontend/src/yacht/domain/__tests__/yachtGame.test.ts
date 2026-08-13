import { describe, expect, it } from 'vitest'
import { createDiceSet, NO_HELD_DICE } from '@/yacht/domain/dice'
import {
  createYachtGame,
  getPendingRoll,
  getRoundSubmission,
  getScoreSummary,
  type RollCount,
  restoreYachtGame,
  type YachtGameState,
  yachtGameReducer,
} from '@/yacht/domain/yachtGame'

describe('yachtGame reducer', () => {
  const serverDice = createDiceSet([6, 5, 4, 3, 2])

  it('stores the dice reported by the matching renderer completion', () => {
    const initial = createYachtGame(42)
    const rolling = yachtGameReducer(initial, {
      type: 'rollRequested',
      requestId: 'roll-1',
      rollCount: 1,
      targetDice: serverDice,
    })
    const renderedDice = createDiceSet([6, 5, 4, 3, 2])

    expect(rolling.phase).toBe('rolling')
    expect(rolling.dice).toBeNull()
    expect(rolling.rollCount).toBe(1)
    expect(getPendingRoll(rolling)?.targetDice).toEqual(serverDice)
    expect(
      yachtGameReducer(rolling, {
        type: 'rollCompleted',
        requestId: 'stale',
        dice: renderedDice,
      }),
    ).toBe(rolling)

    const completed = yachtGameReducer(rolling, {
      type: 'rollCompleted',
      requestId: 'roll-1',
      dice: renderedDice,
    })
    expect(completed.dice).toEqual(renderedDice)
    expect(completed.rollCount).toBe(1)
  })

  it('keeps the server roll count when a forced roll replaces an in-flight roll', () => {
    const afterFirst = finishRoll(createYachtGame(3), 'one')
    const rolling = yachtGameReducer(afterFirst, {
      type: 'rollRequested',
      requestId: 'two',
      rollCount: 2,
      targetDice: serverDice,
    })
    expect(rolling.rollCount).toBe(2)

    const forced = yachtGameReducer(rolling, {
      type: 'rollRequested',
      requestId: 'auto',
      rollCount: 3,
      targetDice: serverDice,
      forced: true,
    })
    expect(forced.rollCount).toBe(3)

    expect(
      yachtGameReducer(forced, { type: 'rollCompleted', requestId: 'two', dice: serverDice }),
    ).toBe(forced)
    const settled = yachtGameReducer(forced, {
      type: 'rollCompleted',
      requestId: 'auto',
      dice: serverDice,
    })
    expect(settled.rollCount).toBe(3)
  })

  it('blocks hold before the first roll and all roll interactions after the third roll', () => {
    const initial = createYachtGame(7)
    expect(yachtGameReducer(initial, { type: 'holdToggled', index: 0 })).toBe(initial)

    let state = finishRoll(initial, 'one')
    state = yachtGameReducer(state, { type: 'holdToggled', index: 0 })
    expect(state.held[0]).toBe(true)
    state = finishRoll(state, 'two')
    state = finishRoll(state, 'three')

    expect(state.rollCount).toBe(3)
    expect(yachtGameReducer(state, { type: 'holdToggled', index: 1 })).toBe(state)
    expect(
      yachtGameReducer(state, {
        type: 'rollRequested',
        requestId: 'four',
        rollCount: 3,
        targetDice: serverDice,
      }),
    ).toBe(state)
  })

  it('ignores roll requests when every die is kept', () => {
    let state = finishRoll(createYachtGame(7), 'one')
    for (const index of [0, 1, 2, 3, 4] as const) {
      state = yachtGameReducer(state, { type: 'holdToggled', index })
    }

    expect(
      yachtGameReducer(state, {
        type: 'rollRequested',
        requestId: 'two',
        rollCount: 2,
        targetDice: serverDice,
      }),
    ).toBe(state)
    expect(
      yachtGameReducer(state, {
        type: 'rollRequested',
        requestId: 'two',
        rollCount: 2,
        targetDice: serverDice,
        held: [true, true, true, true, true],
      }),
    ).toBe(state)

    const fresh = createYachtGame(7)
    expect(
      yachtGameReducer(fresh, {
        type: 'rollRequested',
        requestId: 'first',
        rollCount: 1,
        targetDice: serverDice,
      }).phase,
    ).toBe('rolling')
  })

  it('clears a selected category when another roll starts', () => {
    let state = finishRoll(createYachtGame(1), 'one')
    state = yachtGameReducer(state, { type: 'categorySelected', category: 'choice' })

    const rolling = yachtGameReducer(state, {
      type: 'rollRequested',
      requestId: 'two',
      rollCount: 2,
      targetDice: serverDice,
    })

    expect(rolling.selectedCategory).toBeNull()
  })

  it('blocks duplicate roll and submission actions while processing', () => {
    const rolling = yachtGameReducer(createYachtGame(1), {
      type: 'rollRequested',
      requestId: 'one',
      rollCount: 1,
      targetDice: serverDice,
    })
    expect(
      yachtGameReducer(rolling, {
        type: 'rollRequested',
        requestId: 'two',
        rollCount: 2,
        targetDice: serverDice,
      }),
    ).toBe(rolling)

    let choosing = yachtGameReducer(rolling, {
      type: 'rollCompleted',
      requestId: 'one',
      dice: createDiceSet([1, 2, 3, 4, 5]),
    })
    choosing = yachtGameReducer(choosing, { type: 'categorySelected', category: 'choice' })
    const submitting = yachtGameReducer(choosing, { type: 'submissionStarted' })

    expect(submitting.phase).toBe('submitting')
    expect(yachtGameReducer(submitting, { type: 'submissionStarted' })).toBe(submitting)
    expect(
      yachtGameReducer(submitting, {
        type: 'rollRequested',
        requestId: 'two',
        rollCount: 2,
        targetDice: serverDice,
      }),
    ).toBe(submitting)
  })

  it('returns to category selection when submission fails', () => {
    let state = finishRoll(createYachtGame(1), 'one')
    state = yachtGameReducer(state, { type: 'categorySelected', category: 'choice' })
    state = yachtGameReducer(state, { type: 'submissionStarted' })

    const retryable = yachtGameReducer(state, { type: 'submissionFailed' })

    expect(retryable.phase).toBe('choosing')
    expect(retryable.selectedCategory).toBe('choice')
    expect(getRoundSubmission(retryable)).not.toBeNull()
  })

  it('records a zero-point sacrifice and rejects selecting the used category', () => {
    const choosing: YachtGameState = {
      ...createYachtGame(1),
      phase: 'choosing',
      dice: createDiceSet([1, 1, 2, 2, 4]),
      rollCount: 1,
      selectedCategory: 'fullHouse',
    }
    const submission = getRoundSubmission(choosing)
    const submitting = yachtGameReducer(choosing, { type: 'submissionStarted' })
    const completed = yachtGameReducer(submitting, { type: 'submissionSucceeded' })

    expect(submission?.score).toBe(0)
    expect(completed.scores.fullHouse).toBe(0)
    expect(getScoreSummary(completed).total).toBe(0)

    const nextRound = yachtGameReducer(completed, { type: 'nextRoundStarted' })
    const rolled = finishRoll(nextRound, 'next')
    expect(yachtGameReducer(rolled, { type: 'categorySelected', category: 'fullHouse' })).toBe(
      rolled,
    )
  })

  it('starts the next round with transient state reset and confirmed scores preserved', () => {
    const complete: YachtGameState = {
      ...createYachtGame(9, 3),
      phase: 'roundComplete',
      dice: createDiceSet([1, 2, 3, 4, 5]),
      held: [true, false, true, false, true],
      rollCount: 3,
      scores: { choice: 15 },
      selectedCategory: 'choice',
    }

    const next = yachtGameReducer(complete, { type: 'nextRoundStarted' })

    expect(next).toMatchObject({
      phase: 'ready',
      roundNumber: 4,
      dice: null,
      held: NO_HELD_DICE,
      rollCount: 0,
      scores: { choice: 15 },
      selectedCategory: null,
      pendingRoll: null,
    })
  })
})

describe('restoreYachtGame', () => {
  const serverDice = createDiceSet([6, 5, 4, 3, 2])

  it('restores mid-turn roll progress so the next roll matches the server count', () => {
    const restored = restoreYachtGame(11, 4, {
      rollCount: 2,
      dice: serverDice,
      held: [true, false, true, false, false],
    })

    expect(restored).toMatchObject({
      phase: 'choosing',
      roundNumber: 4,
      rollCount: 2,
      dice: serverDice,
    })
    expect(restored.held).toEqual([true, false, true, false, false])

    const rolling = yachtGameReducer(restored, {
      type: 'rollRequested',
      requestId: 'three',
      rollCount: 3,
      targetDice: serverDice,
    })
    expect(rolling.phase).toBe('rolling')
    expect(rolling.rollCount).toBe(3)
  })

  it('starts fresh when the turn has no dice on the table yet', () => {
    expect(restoreYachtGame(11, 1, { rollCount: 0 })).toMatchObject({
      phase: 'ready',
      rollCount: 0,
      dice: null,
      held: NO_HELD_DICE,
    })
  })

  it('clamps a roll count outside the contract instead of breaking the counter', () => {
    expect(restoreYachtGame(11, 1, { rollCount: 9, dice: serverDice }).rollCount).toBe(3)
    expect(restoreYachtGame(11, 1, { rollCount: -1, dice: serverDice }).rollCount).toBe(0)
  })
})

function finishRoll(state: YachtGameState, requestId: string) {
  const dice = createDiceSet([1, 2, 3, 4, 5])
  const rolling = yachtGameReducer(state, {
    type: 'rollRequested',
    requestId,
    rollCount: (state.rollCount + 1) as RollCount,
    targetDice: dice,
  })
  return yachtGameReducer(rolling, { type: 'rollCompleted', requestId, dice })
}
