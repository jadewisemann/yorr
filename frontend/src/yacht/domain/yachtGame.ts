import { type DiceRollRequest, NO_HELD_DICE } from './dice'
import { calculateScoreSummary, type ScoreSummary } from './scoring'
import {
  canSubmit,
  clampRollCount,
  completeRoll,
  completeSubmission,
  requestRoll,
  selectCategory,
  startNextRound,
  submissionOf,
  syncHeld,
  toggleHold,
} from './yachtTurn'
import type { YachtGameAction, YachtGameState, YachtTurnProgress } from './yachtTypes'

export type { DiceIndex, DiceSet, HeldDice } from './dice'
export { MAX_ROLLS } from './yachtTurn'
export type {
  RollCount,
  RoundSubmission,
  YachtGameAction,
  YachtGamePhase,
  YachtGameState,
  YachtTurnProgress,
} from './yachtTypes'

export function createYachtGame(seed: number, roundNumber = 1): YachtGameState {
  return {
    phase: 'ready',
    roundNumber,
    seed,
    dice: null,
    held: NO_HELD_DICE,
    rollCount: 0,
    scores: {},
    selectedCategory: null,
    pendingRoll: null,
  }
}

/** 재접속 스냅샷의 진행 상황으로 판을 되살린다. 주사위가 없으면 시작 상태다. */
export function restoreYachtGame(
  seed: number,
  roundNumber: number,
  progress: YachtTurnProgress,
): YachtGameState {
  const base = createYachtGame(seed, roundNumber)
  const dice = progress.dice ?? null
  if (!dice) return base
  return {
    ...base,
    phase: 'choosing',
    dice,
    held: progress.held ?? NO_HELD_DICE,
    rollCount: clampRollCount(progress.rollCount),
  }
}

/**
 * 로컬 판의 리듀서 — **어떤 액션이 어떤 전이로 가는가**만 정한다.
 * 전이 본체는 `yachtTurn.ts`가 정본이다.
 */
export function yachtGameReducer(state: YachtGameState, action: YachtGameAction): YachtGameState {
  switch (action.type) {
    case 'rollRequested':
      return requestRoll(state, action)
    case 'rollCompleted':
      return completeRoll(state, action.requestId, action.dice)
    case 'holdToggled':
      return toggleHold(state, action.index)
    case 'heldSynced':
      return syncHeld(state, action.held)
    case 'categorySelected':
      return selectCategory(state, action.category)
    case 'submissionStarted':
      return state.phase === 'choosing' && canSubmit(state)
        ? { ...state, phase: 'submitting' }
        : state
    case 'submissionSucceeded':
      return completeSubmission(state)
    case 'submissionFailed':
      return state.phase === 'submitting' ? { ...state, phase: 'choosing' } : state
    case 'nextRoundStarted':
      return startNextRound(state)
  }
}

export function getPendingRoll(state: YachtGameState): DiceRollRequest | null {
  return state.phase === 'rolling' ? state.pendingRoll : null
}

export function getRoundSubmission(state: YachtGameState) {
  return submissionOf(state)
}

export function getScoreSummary(state: YachtGameState): ScoreSummary {
  return calculateScoreSummary(state.scores)
}

export const TOTAL_ROUNDS = 12
