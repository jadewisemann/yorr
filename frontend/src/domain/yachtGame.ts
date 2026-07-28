import {
  createRollRequest,
  type DiceIndex,
  type DiceRollRequest,
  type DiceSet,
  type HeldDice,
  NO_HELD_DICE,
  nextRollSeed,
  toggleHeldDie,
} from './dice'
import {
  type CategoryScores,
  calculateScoreSummary,
  type ScoreSummary,
  scoreCategory,
  type YachtCategory,
} from './scoring'

export type YachtGamePhase = 'ready' | 'rolling' | 'choosing' | 'submitting' | 'roundComplete'
export type RollCount = 0 | 1 | 2 | 3
export type { DiceIndex } from './dice'

export interface YachtGameState {
  phase: YachtGamePhase
  roundNumber: number
  seed: number
  dice: DiceSet | null
  held: HeldDice
  rollCount: RollCount
  scores: CategoryScores
  selectedCategory: YachtCategory | null
  pendingRoll: DiceRollRequest | null
}

export type YachtGameAction =
  | { type: 'rollRequested'; requestId: string }
  | { type: 'rollCompleted'; requestId: string; dice: DiceSet }
  | { type: 'holdToggled'; index: DiceIndex }
  | { type: 'categorySelected'; category: YachtCategory }
  | { type: 'submissionStarted' }
  | { type: 'submissionSucceeded' }
  | { type: 'submissionFailed' }
  | { type: 'nextRoundStarted' }

export interface RoundSubmission {
  roundNumber: number
  dice: DiceSet
  category: YachtCategory
  score: number
}

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

export function yachtGameReducer(state: YachtGameState, action: YachtGameAction): YachtGameState {
  switch (action.type) {
    case 'rollRequested':
      return requestRoll(state, action.requestId)
    case 'rollCompleted':
      return completeRoll(state, action.requestId, action.dice)
    case 'holdToggled':
      return toggleHold(state, action.index)
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

export function getRoundSubmission(state: YachtGameState): RoundSubmission | null {
  if (!canSubmit(state) || !state.dice || !state.selectedCategory) return null
  return {
    roundNumber: state.roundNumber,
    dice: state.dice,
    category: state.selectedCategory,
    score: scoreCategory(state.dice, state.selectedCategory),
  }
}

export function getScoreSummary(state: YachtGameState): ScoreSummary {
  return calculateScoreSummary(state.scores)
}

function requestRoll(state: YachtGameState, requestId: string): YachtGameState {
  const canRoll = (state.phase === 'ready' || state.phase === 'choosing') && state.rollCount < 3
  if (!canRoll) return state

  return {
    ...state,
    phase: 'rolling',
    selectedCategory: null,
    pendingRoll: createRollRequest({
      requestId,
      seed: state.seed,
      held: state.held,
    }),
  }
}

function completeRoll(state: YachtGameState, requestId: string, dice: DiceSet): YachtGameState {
  if (
    state.phase !== 'rolling' ||
    !state.pendingRoll ||
    state.pendingRoll.requestId !== requestId
  ) {
    return state
  }

  return {
    ...state,
    phase: 'choosing',
    seed: nextRollSeed(state.pendingRoll.seed),
    dice,
    rollCount: incrementRollCount(state.rollCount),
    pendingRoll: null,
  }
}

function toggleHold(state: YachtGameState, index: DiceIndex): YachtGameState {
  if (state.phase !== 'choosing' || !state.dice || state.rollCount >= 3) return state
  return { ...state, held: toggleHeldDie(state.held, index) }
}

function selectCategory(state: YachtGameState, category: YachtCategory): YachtGameState {
  if (state.phase !== 'choosing' || !state.dice || category in state.scores) return state
  return { ...state, selectedCategory: category }
}

function completeSubmission(state: YachtGameState): YachtGameState {
  const submission = getRoundSubmission(state)
  if (state.phase !== 'submitting' || !submission) return state

  return {
    ...state,
    phase: 'roundComplete',
    scores: { ...state.scores, [submission.category]: submission.score },
  }
}

function startNextRound(state: YachtGameState): YachtGameState {
  if (state.phase !== 'roundComplete') return state
  return {
    ...state,
    phase: 'ready',
    roundNumber: state.roundNumber + 1,
    dice: null,
    held: NO_HELD_DICE,
    rollCount: 0,
    selectedCategory: null,
    pendingRoll: null,
  }
}

function canSubmit(state: YachtGameState) {
  return (
    (state.phase === 'choosing' || state.phase === 'submitting') &&
    state.dice !== null &&
    state.selectedCategory !== null &&
    !(state.selectedCategory in state.scores)
  )
}

function incrementRollCount(count: RollCount): RollCount {
  if (count >= 3) return 3
  return (count + 1) as RollCount
}
