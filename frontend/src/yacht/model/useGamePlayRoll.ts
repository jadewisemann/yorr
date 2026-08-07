import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type GameState, type PlayerId } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { type DiceIndex, type DiceSet, NO_HELD_DICE, toggleHeldDie } from '@/yacht/domain/dice'
import { isRecorded } from '@/yacht/domain/yachtCategoryView'
import {
  createYachtGame,
  getPendingRoll,
  MAX_ROLLS,
  restoreYachtGame,
  type YachtGameAction,
  yachtGameReducer,
} from '@/yacht/domain/yachtGame'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'
import { useMotionRollInput } from '@/yacht/input/useMotionRollInput'
import type { RollInputMode } from './roll/animation'
import { latestGameState } from './roll/messages'
import { IDLE_ROLL_PRESENTATION, rollPresentationReducer } from './roll/presentation'
import { createRollTracking } from './roll/tracking'
import { useRollBroadcast } from './roll/useBroadcast'
import { useRollFeedback } from './roll/useFeedback'
import { useRollIncoming } from './roll/useIncoming'

const TAP_RELEASE_DELAY_MS = 600

interface UseGamePlayRollOptions {
  game: GameState | undefined
  roomId: string
  showToast: (message: string) => void
  you: PlayerId
  canPlay: boolean
}

export function useGamePlayRoll({ canPlay, game, roomId, showToast, you }: UseGamePlayRollOptions) {
  const realtimeClient = useRealtimeClient()
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const renderedGameRef = useRef(game)

  const roundNumber = game?.roundNumber ?? 1
  const activePlayerId = game?.activePlayerId
  const isMyTurn = activePlayerId === you
  const activeBoard = activePlayerId ? game?.scores[activePlayerId] : undefined

  const [local, setLocal] = useState(() =>
    restoreYachtGame(Date.now() >>> 0, roundNumber, {
      rollCount: game?.rollCount ?? 0,
      dice: game?.dice ?? null,
      held: game?.held ?? null,
    }),
  )
  const [presentation, present] = useReducer(rollPresentationReducer, IDLE_ROLL_PRESENTATION)
  const {
    inputMode: rollInputMode,
    releaseRequestId,
    remoteShaking,
    requesting: requestingRoll,
  } = presentation
  const feedback = useRollFeedback()

  const trackingRef = useRef(createRollTracking())
  const activePlayerRef = useRef(activePlayerId)
  const rollSequenceRef = useRef(0)
  const inputModeRef = useRef(rollInputMode)
  useLayoutEffect(() => {
    renderedGameRef.current = game
    inputModeRef.current = rollInputMode
  })

  const resetLocalFor = useCallback(
    (round: number) => setLocal((state) => createYachtGame(state.seed, round)),
    [],
  )

  if (local.roundNumber !== roundNumber) resetLocalFor(roundNumber)

  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    const acceptedRollTurn = trackingRef.current.takeAcceptedTurn()
    const diceForThisTurnAlreadyArrived =
      acceptedRollTurn?.playerId === activePlayerId && acceptedRollTurn?.roundNumber === roundNumber
    if (!diceForThisTurnAlreadyArrived) resetLocalFor(roundNumber)
    present({ type: 'turnReset' })
    trackingRef.current.reset()
  }, [activePlayerId, resetLocalFor, roundNumber])

  const dispatch = useCallback((action: YachtGameAction) => {
    setLocal((state) => yachtGameReducer(state, action))
  }, [])

  const submitted = local.phase === 'roundComplete'
  const submitting = local.phase === 'submitting'
  const rollsLeft = MAX_ROLLS - local.rollCount
  const keptCount = local.held.filter(Boolean).length
  const allKept = local.dice !== null && keptCount === 5
  const locked = connectionStatus === 'reconnecting' || connectionStatus === 'closed' || !isMyTurn
  const canRoll =
    !locked &&
    !submitted &&
    !requestingRoll &&
    !allKept &&
    rollsLeft > 0 &&
    (local.phase === 'ready' || local.phase === 'choosing')
  const rolling = local.phase === 'rolling' || requestingRoll
  const canHold = !locked && !submitted && local.phase === 'choosing' && local.rollCount < MAX_ROLLS
  const canPick = !locked && !submitting && local.phase === 'choosing'
  const lastRollInPlay = local.rollCount >= MAX_ROLLS
  const currentRollNumber =
    local.phase === 'rolling' ? local.rollCount : Math.min(MAX_ROLLS, local.rollCount + 1)
  const settledRollCount = local.phase === 'rolling' ? local.rollCount - 1 : local.rollCount

  const { publishHeld, publishShake, publishThrow } = useRollBroadcast(roomId, roundNumber)

  const beginRoll = useCallback(
    (inputMode: RollInputMode) => {
      if (!canRoll) return
      rollSequenceRef.current += 1
      const requestId = `r${roundNumber}-${rollSequenceRef.current}`
      const msgId = `roll-${roundNumber}-${local.rollCount + 1}-${Date.now()}`
      present({ type: 'requested', inputMode })
      inputModeRef.current = inputMode
      trackingRef.current.requested({ inputMode, msgId, requestId })
      try {
        realtimeClient.send(
          buildClientMessage(
            'game.yacht_dice.dice.roll',
            {
              held: local.held,
              rollCount: (local.rollCount + 1) as 1 | 2 | 3,
              roundNumber,
            },
            { roomId, msgId },
          ),
        )
      } catch {
        trackingRef.current.settle()
        present({ type: 'requestFailed' })
        showToast('주사위를 요청하지 못했어요. 연결 상태를 확인해 주세요.')
      }
    },
    [canRoll, local.held, local.rollCount, realtimeClient, roomId, roundNumber, showToast],
  )

  useRollIncoming({
    activePlayerId,
    currentGame: () =>
      latestGameState(renderedGameRef.current, useAppStore.getState().roomSnapshot?.game),
    dispatch,
    feedback,
    present,
    publishThrow,
    roomId,
    roundNumber,
    setLocal,
    showToast,
    tracking: trackingRef.current,
    you,
  })

  const handleGestureEvent = useCallback(
    (event: MotionGestureEvent) => {
      switch (event.type) {
        case 'shakePulse':
          feedback.pulse(event.direction, event.strength, 'local')
          publishShake(event.direction, event.strength)
          return
        case 'shakeStarted':
          feedback.armed()
          beginRoll('motion')
          return
        case 'throwDetected': {
          const request = getPendingRoll(local)
          if (inputModeRef.current !== 'motion') return
          if (!request) {
            trackingRef.current.queueMotionRelease()
            return
          }
          feedback.thrown()
          present({ type: 'released', requestId: request.requestId })
          publishThrow(local.rollCount)
          return
        }
        case 'shakeArmed':
        case 'gestureCancelled':
          return
      }
    },
    [beginRoll, feedback, local, publishShake, publishThrow],
  )

  const motion = useMotionRollInput(handleGestureEvent, canPlay)
  const pendingRoll = getPendingRoll(local)

  useEffect(() => {
    if (!pendingRoll || (rollInputMode !== 'tap' && rollInputMode !== 'auto')) return
    const timeout = setTimeout(() => {
      present({ type: 'released', requestId: pendingRoll.requestId })
      if (rollInputMode === 'tap') publishThrow(local.rollCount)
    }, TAP_RELEASE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [local.rollCount, pendingRoll, publishThrow, rollInputMode])

  const roll = useCallback(() => beginRoll('tap'), [beginRoll])

  const confirmThrow = useCallback(() => {
    if (!pendingRoll || releaseRequestId === pendingRoll.requestId) return
    feedback.thrown()
    present({ type: 'released', requestId: pendingRoll.requestId })
    publishThrow(local.rollCount)
  }, [feedback, local.rollCount, pendingRoll, publishThrow, releaseRequestId])

  const completeRoll = useCallback(
    (requestId: string, _dice: DiceSet) => {
      const completedDice = pendingRoll?.requestId === requestId ? pendingRoll.targetDice : null
      if (!completedDice) return
      dispatch({ type: 'rollCompleted', requestId, dice: completedDice })
      present({ type: 'completed' })
      if (isMyTurn) motion.resetGesture('roll-complete')
      feedback.highlightSpecialHand(completedDice, (candidate) =>
        isRecorded(activeBoard?.categories[candidate]),
      )
    },
    [activeBoard, dispatch, feedback, isMyTurn, motion, pendingRoll],
  )

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

  return {
    allKept,
    canHold,
    canPlay,
    canPick,
    canRoll,
    completeRoll,
    confirmThrow,
    currentRollNumber,
    dispatch,
    lastRollInPlay,
    keptCount,
    local,
    motion,
    feedback,
    pendingRoll,
    releaseAll,
    releaseRequestId,
    remoteShaking,
    roll,
    rollInputMode,
    rolling,
    rollsLeft,
    settledRollCount,
    submitting,
    submitted,
    toggleHeld,
  }
}

export type GamePlayRoll = ReturnType<typeof useGamePlayRoll>
