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
  /**
   * `forced`는 서버가 마감 시각에 대신 굴린 결과를 뜻한다. 서버 상태가 이미 그 값으로 확정됐으니
   * 로컬 phase가 무엇이든(애니메이션 중이라도) 받아들여야 한다 — 거부하면 화면만 뒤처진다.
   */
  | {
      type: 'rollRequested'
      requestId: string
      targetDice: DiceSet
      held?: HeldDice
      forced?: boolean
    }
  | { type: 'rollCompleted'; requestId: string; dice: DiceSet }
  | { type: 'holdToggled'; index: DiceIndex }
  /**
   * 서버가 알려준 턴 주인의 KEEP으로 통째로 맞춘다. 관전자가 상대의 KEEP을 따라가는 경로다.
   * 토글(holdToggled)과 달리 전체 배열을 받는다 — 한 번 놓쳐도 다음 동기화에서 복구된다.
   */
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

export function yachtGameReducer(state: YachtGameState, action: YachtGameAction): YachtGameState {
  switch (action.type) {
    case 'rollRequested':
      return requestRoll(state, action.requestId, action.targetDice, action.held, action.forced)
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
  requestId: string,
  targetDice: DiceSet,
  heldOverride?: HeldDice,
  forced = false,
): YachtGameState {
  // 서버가 대신 굴린 결과는 이미 확정된 사실이라 phase 게이트를 통과시킨다.
  // 굴림 예산은 서버가 지키므로 rollCount 상한만 남긴다.
  const canRoll = forced
    ? state.phase !== 'roundComplete' && state.rollCount < 3
    : (state.phase === 'ready' || state.phase === 'choosing') && state.rollCount < 3
  if (!canRoll) return state

  // 다섯 개를 전부 킵하면 굴릴 주사위가 0개다 — 요청 자체를 무시한다.
  const nextHeld = heldOverride ?? state.held
  if (state.dice !== null && nextHeld.every(Boolean)) return state

  return {
    ...state,
    phase: 'rolling',
    selectedCategory: null,
    pendingRoll: createRollRequest({
      requestId,
      seed: state.seed,
      held: nextHeld,
      targetDice,
    }),
    held: nextHeld,
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

/**
 * 서버가 확정한 KEEP으로 맞춘다. 주사위가 깔린 뒤에만 의미가 있고, 굴림 애니메이션 중에는
 * 그 굴림에 쓸 held가 이미 정해져 있으므로 건드리지 않는다.
 */
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

function incrementRollCount(count: RollCount): RollCount {
  if (count >= 3) return 3
  return (count + 1) as RollCount
}
