import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import {
  buildClientMessage,
  type PlayerId,
  type ScoreBoard,
  type ServerMessage,
} from '@/realtime/wsEvents'
import type { DiceSet } from '@/yacht/domain/dice'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { categoryLabel } from '@/yacht/domain/yachtCategoryView'
import type { YachtGameAction } from '@/yacht/domain/yachtGame'
import { turnAwareErrorMessage } from './roll/messages'
import { newlyRecordedCategory } from './scoreDiff'

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
  // 렌더 중에 ref를 쓰지 않는다 — 버려지는 렌더(동시성)에서 커밋되지 않은 값이 남는다.
  // layout effect는 페인트 전에 돌아서 이벤트·rAF가 읽는 시점에는 이미 최신이다.
  useLayoutEffect(() => {
    previousBoardRef.current = myBoard
  })

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
          buildClientMessage(
            'game.yacht_dice.round.submit',
            { category, dice, roundNumber },
            { roomId, msgId },
          ),
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
        message.type !== 'game.yacht_dice.score.update' ||
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
          message.type === 'game.yacht_dice.score.update' &&
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
