import { useCallback } from 'react'
import type { ScoreBoard } from '@/realtime/wsEvents'
import type { DiceIndex, DiceSet } from '@/yacht/domain/dice'
import { NO_HELD_DICE, toggleHeldDie } from '@/yacht/domain/dice'
import { isRecorded } from '@/yacht/domain/yachtCategoryView'
import type { getPendingRoll, YachtGameAction, YachtGameState } from '@/yacht/domain/yachtGame'
import type { RollPresentationAction } from './presentation'
import type { useRollFeedback } from './useFeedback'

interface DiceActionsOptions {
  activeBoard: ScoreBoard | undefined
  canHold: boolean
  dispatch: (action: YachtGameAction) => void
  feedback: ReturnType<typeof useRollFeedback>
  isMyTurn: boolean
  local: YachtGameState
  pendingRoll: ReturnType<typeof getPendingRoll>
  present: (action: RollPresentationAction) => void
  publishHeld: (held: YachtGameState['held']) => void
  publishThrow: (rollCount: number) => void
  releaseRequestId: string | null
  resetGesture: (reason: 'roll-complete') => void
}

/**
 * 주사위와 직접 상호작용하는 동작 — 유지 토글·전체 해제·던짐 확정·굴림 완료.
 * 모두 `useGamePlayRoll`의 상태에서 파생되므로 판정만 받아 동작에만 집중한다.
 */
export function useDiceActions(options: DiceActionsOptions) {
  const {
    activeBoard,
    canHold,
    dispatch,
    feedback,
    isMyTurn,
    local,
    pendingRoll,
    present,
    publishHeld,
    publishThrow,
    releaseRequestId,
    resetGesture,
  } = options

  const completeRoll = useCallback(
    (requestId: string, _dice: DiceSet) => {
      const completedDice = pendingRoll?.requestId === requestId ? pendingRoll.targetDice : null
      if (!completedDice) return
      dispatch({ type: 'rollCompleted', requestId, dice: completedDice })
      present({ type: 'completed' })
      if (isMyTurn) resetGesture('roll-complete')
      feedback.highlightSpecialHand(completedDice, (candidate) =>
        isRecorded(activeBoard?.categories[candidate]),
      )
    },
    [activeBoard, dispatch, feedback, isMyTurn, pendingRoll, present, resetGesture],
  )

  const confirmThrow = useCallback(() => {
    if (!pendingRoll || releaseRequestId === pendingRoll.requestId) return
    feedback.thrown()
    present({ type: 'released', requestId: pendingRoll.requestId })
    publishThrow(local.rollCount)
  }, [feedback, local.rollCount, pendingRoll, present, publishThrow, releaseRequestId])

  const toggleHeld = useCallback(
    (index: DiceIndex) => {
      if (!canHold) return
      dispatch({ type: 'holdToggled', index })
      publishHeld(toggleHeldDie(local.held, index))
    },
    [canHold, dispatch, local.held, publishHeld],
  )

  const releaseAll = useCallback(() => {
    local.held.forEach((isHeld, index) => {
      if (isHeld) dispatch({ type: 'holdToggled', index: index as DiceIndex })
    })
    publishHeld(NO_HELD_DICE)
  }, [dispatch, local.held, publishHeld])

  return { completeRoll, confirmThrow, releaseAll, toggleHeld }
}
