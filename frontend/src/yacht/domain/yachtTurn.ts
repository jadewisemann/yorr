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
import { scoreCategory, type YachtCategory } from './scoring'
import type {
  RollCount,
  RoundSubmission,
  YachtGameAction,
  YachtGameState,
  YachtTurnProgress,
} from './yachtTypes'

export type { RoundSubmission, YachtTurnProgress }

/**
 * 야추 로컬 클라이언트의 **턴 전이** — 굴림 요청·완료, 킵, 카테고리 선택, 제출.
 *
 * `yachtGame.ts`에서 갈라 둔 이유: 상태 타입과 리듀서 표(어떤 액션이 어떤 전이로
 * 가는가)는 한눈에 봐야 하고, 각 전이의 가드 조건은 그 자체로 길다. 타입·생성·선택자는
 * `yachtGame.ts`에, 전이는 여기에 둔다.
 */

export const MAX_ROLLS = 3

/** 굴림을 요청할 수 있는가 — `forced`는 서버 대리 굴림(연출·복구) 경로다. */
export const canRequestRoll = (state: YachtGameState, forced: boolean): boolean =>
  forced
    ? state.phase !== 'roundComplete' && state.rollCount < MAX_ROLLS
    : (state.phase === 'ready' || state.phase === 'choosing') && state.rollCount < MAX_ROLLS

export function requestRoll(
  state: YachtGameState,
  action: Extract<YachtGameAction, { type: 'rollRequested' }>,
): YachtGameState {
  const { forced = false, held: heldOverride, requestId, rollCount, seed, targetDice } = action
  if (!canRequestRoll(state, forced)) return state

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

/** 굴림 결과 도착. **요청 id가 일치할 때만** 적용한다(늦게 온 옛 굴림 방어). */
export function completeRoll(
  state: YachtGameState,
  requestId: string,
  dice: DiceSet,
): YachtGameState {
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

export function toggleHold(state: YachtGameState, index: DiceIndex): YachtGameState {
  if (state.phase !== 'choosing' || !state.dice || state.rollCount >= MAX_ROLLS) return state
  return { ...state, held: toggleHeldDie(state.held, index) }
}

export function syncHeld(state: YachtGameState, held: HeldDice): YachtGameState {
  if (state.phase !== 'choosing' || !state.dice) return state
  return { ...state, held }
}

export function selectCategory(state: YachtGameState, category: YachtCategory): YachtGameState {
  if (state.phase !== 'choosing' || !state.dice || category in state.scores) return state
  return { ...state, selectedCategory: category }
}

/** 제출 성공 — 점수판을 확정하고 라운드 완료로. */
export function completeSubmission(state: YachtGameState): YachtGameState {
  const submission = submissionOf(state)
  if (state.phase !== 'submitting' || !submission) return state

  return {
    ...state,
    phase: 'roundComplete',
    scores: { ...state.scores, [submission.category]: submission.score },
  }
}

export function startNextRound(state: YachtGameState): YachtGameState {
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

/** 제출 가능 여부 — 고른 칸이 아직 비어 있어야 한다. */
export function canSubmit(state: YachtGameState): boolean {
  return (
    (state.phase === 'choosing' || state.phase === 'submitting') &&
    state.dice !== null &&
    state.selectedCategory !== null &&
    !(state.selectedCategory in state.scores)
  )
}

/** 지금 제출할 수 있는 내용(없으면 null). */
export function submissionOf(state: YachtGameState): RoundSubmission | null {
  if (!canSubmit(state) || !state.dice || !state.selectedCategory) return null
  return {
    roundNumber: state.roundNumber,
    dice: state.dice,
    category: state.selectedCategory,
    score: scoreCategory(state.dice, state.selectedCategory),
  }
}

/** 외부에서 온 굴림 횟수를 상태 타입으로 좁힌다. */
export function clampRollCount(count: number): RollCount {
  if (!Number.isInteger(count) || count < 0) return 0
  return (count > 3 ? 3 : count) as RollCount
}

/** 굴림 요청 타입이 전이에서만 쓰이는 것을 명시한다(공개 표면 유지). */
export type { DiceRollRequest }
