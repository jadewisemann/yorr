import {
  type DiceIndex,
  type DiceRollRequest,
  type DiceSet,
  type HeldDice,
  NO_HELD_DICE,
} from './dice'
import type { CategoryScores, YachtCategory } from './scoring'
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

export type YachtGamePhase = 'ready' | 'rolling' | 'choosing' | 'submitting' | 'roundComplete'
export type RollCount = 0 | 1 | 2 | 3
export type { DiceIndex } from './dice'
export { MAX_ROLLS, type RoundSubmission } from './yachtTurn'

/** 로컬 판의 점수판 — 서버와 같은 모양(카테고리 → 확정 점수). */
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
