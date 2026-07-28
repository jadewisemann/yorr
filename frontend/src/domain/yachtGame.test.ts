import { describe, expect, it } from 'vitest'
import { createDiceSet, NO_HELD_DICE } from './dice'
import {
  createYachtGame,
  getPendingRoll,
  getRoundSubmission,
  getScoreSummary,
  type YachtGameState,
  yachtGameReducer,
} from './yachtGame'

describe('yachtGame reducer', () => {
  const serverDice = createDiceSet([6, 5, 4, 3, 2])

  it('stores the dice reported by the matching renderer completion', () => {
    const initial = createYachtGame(42)
    const rolling = yachtGameReducer(initial, {
      type: 'rollRequested',
      requestId: 'roll-1',
      targetDice: serverDice,
    })
    const renderedDice = createDiceSet([6, 5, 4, 3, 2])

    expect(rolling.phase).toBe('rolling')
    expect(rolling.dice).toBeNull()
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
        targetDice: serverDice,
      }),
    ).toBe(state)
  })

  it('clears a selected category when another roll starts', () => {
    let state = finishRoll(createYachtGame(1), 'one')
    state = yachtGameReducer(state, { type: 'categorySelected', category: 'choice' })

    const rolling = yachtGameReducer(state, {
      type: 'rollRequested',
      requestId: 'two',
      targetDice: serverDice,
    })

    expect(rolling.selectedCategory).toBeNull()
  })

  it('blocks duplicate roll and submission actions while processing', () => {
    const rolling = yachtGameReducer(createYachtGame(1), {
      type: 'rollRequested',
      requestId: 'one',
      targetDice: serverDice,
    })
    expect(
      yachtGameReducer(rolling, {
        type: 'rollRequested',
        requestId: 'two',
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

function finishRoll(state: YachtGameState, requestId: string) {
  const dice = createDiceSet([1, 2, 3, 4, 5])
  const rolling = yachtGameReducer(state, { type: 'rollRequested', requestId, targetDice: dice })
  return yachtGameReducer(rolling, { type: 'rollCompleted', requestId, dice })
}
