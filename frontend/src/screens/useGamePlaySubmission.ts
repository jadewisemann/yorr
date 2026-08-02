import { useCallback, useEffect, useRef } from 'react'
import type { DiceSet } from '@/domain/dice'
import type { YachtCategory } from '@/domain/scoring'
import type { YachtGameAction } from '@/domain/yachtGame'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { PlayerId, ScoreBoard, ServerMessage } from '@/realtime/wsEvents'
import { buildClientMessage } from '@/realtime/wsEvents'
import { categoryLabel } from '@/yachtCategoryView'
import { newlyRecordedCategory, turnAwareErrorMessage } from './gamePlayModel'

interface UseGamePlaySubmissionOptions {
  activePlayerId: PlayerId | undefined
  dice: DiceSet | null
  dispatch: (action: YachtGameAction) => void
  myBoard: ScoreBoard | undefined
  onSucceeded: () => void
  roomId: string
  roundNumber: number
  showToast: (message: string) => void
  you: PlayerId
}

export function useGamePlaySubmission({
  activePlayerId,
  dice,
  dispatch,
  myBoard,
  onSucceeded,
  roomId,
  roundNumber,
  showToast,
  you,
}: UseGamePlaySubmissionOptions) {
  const realtimeClient = useRealtimeClient()
  const pendingRef = useRef<{ msgId: string } | null>(null)
  const previousBoardRef = useRef(myBoard)
  const autoRecordedRoundRef = useRef<number | null>(null)
  const turnKey = `${roundNumber}:${activePlayerId ?? ''}`
  const previousTurnKeyRef = useRef(turnKey)
  previousBoardRef.current = myBoard

  useEffect(() => {
    if (previousTurnKeyRef.current === turnKey) return
    previousTurnKeyRef.current = turnKey
    pendingRef.current = null
  }, [turnKey])

  const submitCategory = useCallback(
    (category: YachtCategory) => {
      if (!dice) return
      const msgId = `round-${roundNumber}-${Date.now()}`
      dispatch({ type: 'categorySelected', category })
      dispatch({ type: 'submissionStarted' })
      pendingRef.current = { msgId }
      try {
        realtimeClient.send(
          buildClientMessage('round.submit', { category, dice, roundNumber }, { roomId, msgId }),
        )
      } catch {
        pendingRef.current = null
        dispatch({ type: 'submissionFailed' })
        showToast('점수를 기록하지 못했어요. 다시 시도해 주세요.')
      }
    },
    [dice, dispatch, realtimeClient, roomId, roundNumber, showToast],
  )

  const handleAutomaticRecord = useCallback(
    (message: ServerMessage) => {
      if (
        message.type !== 'score.update' ||
        message.payload.playerId !== you ||
        autoRecordedRoundRef.current === roundNumber
      ) {
        return
      }
      const recorded = newlyRecordedCategory(previousBoardRef.current, message.payload.scoreboard)
      if (!recorded) return
      autoRecordedRoundRef.current = roundNumber
      showToast(`시간이 지나 ${categoryLabel[recorded[0]]} ${recorded[1]}점으로 자동 기록됐어요.`)
    },
    [roundNumber, showToast, you],
  )

  useEffect(
    () =>
      realtimeClient.onMessage((message) => {
        const pending = pendingRef.current
        if (!pending) return handleAutomaticRecord(message)

        if (
          message.type === 'score.update' &&
          message.msgId === pending.msgId &&
          message.payload.playerId === you
        ) {
          pendingRef.current = null
          dispatch({ type: 'submissionSucceeded' })
          onSucceeded()
          return
        }

        if (message.type === 'error' && message.payload.refMsgId === pending.msgId) {
          pendingRef.current = null
          dispatch({ type: 'submissionFailed' })
          showToast(turnAwareErrorMessage(message.payload))
        }
      }),
    [dispatch, handleAutomaticRecord, onSucceeded, realtimeClient, showToast, you],
  )

  return { submitCategory }
}
