import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { GameState, PlayerId } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'

import {
  createYachtGame,
  getPendingRoll,
  restoreYachtGame,
  type YachtGameAction,
  yachtGameReducer,
} from '@/yacht/domain/yachtGame'
import { useMotionRollInput } from '@/yacht/input/useMotionRollInput'
import { rollAvailabilityOf } from './roll/availability'
import { latestGameState } from './roll/messages'
import { IDLE_ROLL_PRESENTATION, rollPresentationReducer } from './roll/presentation'
import { createRollTracking } from './roll/tracking'
import { useRollBroadcast } from './roll/useBroadcast'
import { useDiceActions } from './roll/useDiceActions'
import { useRollFeedback } from './roll/useFeedback'
import { useRollGesture, useTapRelease } from './roll/useGesture'
import { useRollIncoming } from './roll/useIncoming'
import { useRollRequest, useTurnReset } from './roll/useRollRequest'

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

  useTurnReset({
    activePlayerId,
    present,
    resetLocalFor,
    roundNumber,
    tracking: trackingRef.current,
  })

  const dispatch = useCallback((action: YachtGameAction) => {
    setLocal((state) => yachtGameReducer(state, action))
  }, [])

  const availability = rollAvailabilityOf({
    connectionStatus,
    isMyTurn,
    local,
    requestingRoll,
  })
  const { canHold, canRoll } = availability

  const { publishHeld, publishShake, publishThrow } = useRollBroadcast(roomId, roundNumber)

  const beginRoll = useRollRequest({
    canRoll,
    inputModeRef,
    local,
    present,
    realtimeClient,
    roomId,
    roundNumber,
    showToast,
    tracking: trackingRef.current,
  })

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

  const handleGestureEvent = useRollGesture({
    beginRoll,
    feedback,
    inputModeRef,
    local,
    present,
    publishShake,
    publishThrow,
    tracking: trackingRef.current,
  })
  const motion = useMotionRollInput(handleGestureEvent, canPlay)
  const pendingRoll = getPendingRoll(local)

  useTapRelease({ local, present, publishThrow, rollInputMode })

  const roll = useCallback(() => beginRoll('tap'), [beginRoll])

  const { completeRoll, confirmThrow, releaseAll, toggleHeld } = useDiceActions({
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
    resetGesture: motion.resetGesture,
  })

  return {
    ...availability,
    canPlay,
    completeRoll,
    confirmThrow,
    dispatch,
    local,
    motion,
    feedback,
    pendingRoll,
    releaseAll,
    releaseRequestId,
    remoteShaking,
    roll,
    rollInputMode,
    toggleHeld,
  }
}

export type GamePlayRoll = ReturnType<typeof useGamePlayRoll>
