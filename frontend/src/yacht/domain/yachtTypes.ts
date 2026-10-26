import type { DiceIndex, DiceRollRequest, DiceSet, HeldDice } from './dice'
import type { CategoryScores, YachtCategory } from './scoring'

/**
 * 야추 로컬 클라이언트의 **도메인 타입** — 상태·액션·제출 묶음.
 *
 * 왜 별도 파일인가: 리듀서 표(`yachtGame`)와 전이 본체(`yachtTurn`)가 서로의 타입을
 * 참조하면 순환 의존이 된다. 타입만 여기 두면 의존이 한 방향으로 유지된다.
 */

export type YachtGamePhase = 'ready' | 'rolling' | 'choosing' | 'submitting' | 'roundComplete'
export type RollCount = 0 | 1 | 2 | 3

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

/** 제출 묶음 — 서버 `round.submit`의 모양과 같다. */
export interface RoundSubmission {
  roundNumber: number
  dice: DiceSet
  category: YachtCategory
  score: number
}

/** 재접속 스냅샷의 진행 상황. */
export interface YachtTurnProgress {
  rollCount: number
  dice?: DiceSet | null
  held?: HeldDice | null
}
