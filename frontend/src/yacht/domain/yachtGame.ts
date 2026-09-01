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

type YachtGamePhase = 'ready' | 'rolling' | 'choosing' | 'submitting' | 'roundComplete'
export type RollCount = 0 | 1 | 2 | 3
export const MAX_ROLLS = 3

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
  | {
      type: 'rollRequested'
      requestId: string
      rollCount: RollCount
      seed?: number
      targetDice: DiceSet
      held?: HeldDice
      forced?: boolean
    }
  | { type: 'rollCompleted'; requestId: string; dice: DiceSet }
  | { type: 'holdToggled'; index: DiceIndex }
  | { type: 'heldSynced'; held: HeldDice }
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

export interface YachtTurnProgress {
  rollCount: number
  dice?: DiceSet | null
  held?: HeldDice | null
}

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

function requestRoll(
  state: YachtGameState,
  action: Extract<YachtGameAction, { type: 'rollRequested' }>,
): YachtGameState {
  const { forced = false, held: heldOverride, requestId, rollCount, seed, targetDice } = action
  const canRoll = forced
    ? state.phase !== 'roundComplete' && state.rollCount < MAX_ROLLS
    : (state.phase === 'ready' || state.phase === 'choosing') && state.rollCount < MAX_ROLLS
  if (!canRoll) return state

  const nextHeld = heldOverride ?? state.held
  if (state.dice !== null && nextHeld.every(Boolean)) return state

  return {
    ...state,
    phase: 'rolling',
    selectedCategory: null,
    pendingRoll: createRollRequest({
      requestId,
      seed: seed ?? state.seed,
      held: nextHeld,
      targetDice,
    }),
    held: nextHeld,
    rollCount,
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
    pendingRoll: null,
  }
}

function toggleHold(state: YachtGameState, index: DiceIndex): YachtGameState {
  if (state.phase !== 'choosing' || !state.dice || state.rollCount >= MAX_ROLLS) return state
  return { ...state, held: toggleHeldDie(state.held, index) }
}

function syncHeld(state: YachtGameState, held: HeldDice): YachtGameState {
  if (state.phase !== 'choosing' || !state.dice) return state
  return { ...state, held }
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

function clampRollCount(count: number): RollCount {
  if (!Number.isInteger(count) || count < 0) return 0
  return (count > 3 ? 3 : count) as RollCount
}

export const TOTAL_ROUNDS = 12
