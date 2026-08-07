import { useCallback, useEffect } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { GameState, PlayerId, ServerMessage } from '@/realtime/wsEvents'
import type { HeldDice } from '@/yacht/domain/dice'
import {
  createYachtGame,
  type YachtGameAction,
  type YachtGameState,
  yachtGameReducer,
} from '@/yacht/domain/yachtGame'
import { animationSeedForRoll, rollAnimationMode } from './animation'
import { isCurrentDiceBroadcast, turnAwareErrorMessage } from './messages'
import type { RollPresentationAction } from './presentation'
import type { RollTracking } from './tracking'
import type { useRollFeedback } from './useFeedback'

type DiceBroadcastMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.broadcast' }>
type DiceShakenMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.shaken' }>
type DiceThrownMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.thrown' }>
type DiceHoldChangedMessage = Extract<ServerMessage, { type: 'game.yacht_dice.dice.hold_changed' }>
type ErrorMessage = Extract<ServerMessage, { type: 'error' }>

interface PendingRollRequest {
  inputMode: 'motion' | 'tap'
  msgId: string
  requestId: string
}

function pendingInputModeFor(
  message: DiceBroadcastMessage,
  ownRoll: boolean,
  forced: boolean,
  pending: PendingRollRequest | null,
) {
  return ownRoll && !forced && pending?.msgId === message.msgId
    ? (pending?.inputMode ?? null)
    : null
}

interface UseRollIncomingOptions {
  activePlayerId: PlayerId | undefined
  currentGame: () => GameState | undefined
  dispatch: (action: YachtGameAction) => void
  feedback: ReturnType<typeof useRollFeedback>
  present: (action: RollPresentationAction) => void
  publishThrow: (rollCount: number) => void
  roomId: string
  roundNumber: number
  setLocal: (update: (state: YachtGameState) => YachtGameState) => void
  showToast: (message: string) => void
  tracking: RollTracking
  you: PlayerId
}

export function useRollIncoming({
  activePlayerId,
  currentGame,
  dispatch,
  feedback,
  present,
  publishThrow,
  roomId,
  roundNumber,
  setLocal,
  showToast,
  tracking,
  you,
}: UseRollIncomingOptions) {
  const realtimeClient = useRealtimeClient()

  const handleBroadcast = useCallback(
    (message: DiceBroadcastMessage) => {
      if (!isCurrentDiceBroadcast(message, roomId, currentGame())) return
      const ownRoll = message.payload.playerId === you
      const forced = message.payload.auto === true
      const pending = tracking.settle()
      const requestId = `roll-${message.payload.playerId}-${message.payload.roundNumber}-${message.payload.rollCount}`
      const animationMode = rollAnimationMode({
        forced,
        ownRoll,
        pendingInputMode: pendingInputModeFor(message, ownRoll, forced, pending),
      })
      const releaseNow = tracking.remote.rollAccepted(
        animationMode === 'remote'
          ? {
              requestId,
              rollCount: message.payload.rollCount,
              roundNumber: message.payload.roundNumber,
            }
          : null,
      )
      present({ type: 'broadcastAccepted', mode: animationMode })
      tracking.accept({
        playerId: message.payload.playerId,
        roundNumber: message.payload.roundNumber,
      })
      setLocal((state) =>
        yachtGameReducer(
          state.roundNumber === message.payload.roundNumber
            ? state
            : createYachtGame(state.seed, message.payload.roundNumber),
          {
            type: 'rollRequested',
            forced,
            held: message.payload.held as HeldDice,
            requestId,
            rollCount: message.payload.rollCount,
            seed: animationSeedForRoll(
              roomId,
              message.payload.playerId,
              message.payload.roundNumber,
              message.payload.rollCount,
              message.payload.dice,
            ),
            targetDice: message.payload.dice,
          },
        ),
      )
      if (ownRoll && forced) {
        showToast(`시간이 지나 서버가 ${message.payload.rollCount}번째 주사위를 굴렸어요.`)
      }
      if (ownRoll && tracking.takeQueuedMotionRelease()) {
        present({ type: 'released', requestId })
        publishThrow(message.payload.rollCount)
      }
      if (releaseNow) present({ type: 'released', requestId: releaseNow })
    },
    [
      publishThrow,
      roomId,
      showToast,
      you,
      currentGame,
      tracking.settle,
      tracking.remote.rollAccepted,
      tracking.takeQueuedMotionRelease,
      tracking.accept,
      setLocal,
      present,
    ],
  )

  const handleShaken = useCallback(
    (message: DiceShakenMessage) => {
      if (
        message.roomId !== roomId ||
        message.payload.roundNumber !== roundNumber ||
        message.payload.playerId !== activePlayerId ||
        message.payload.playerId === you ||
        !tracking.remote.rolling
      ) {
        return
      }
      present({ type: 'remoteShakeStarted' })
      feedback.pulse(message.payload.direction, message.payload.strength, 'remote')
    },
    [activePlayerId, feedback.pulse, roomId, roundNumber, you, tracking.remote.rolling, present],
  )

  const handleThrown = useCallback(
    (message: DiceThrownMessage) => {
      if (
        message.roomId !== roomId ||
        message.payload.roundNumber !== roundNumber ||
        message.payload.playerId !== activePlayerId ||
        message.payload.playerId === you
      ) {
        return
      }
      const releaseNow = tracking.remote.throwObserved({
        rollCount: message.payload.rollCount,
        roundNumber: message.payload.roundNumber,
      })
      if (releaseNow) present({ type: 'released', requestId: releaseNow })
    },
    [activePlayerId, roomId, roundNumber, you, tracking.remote.throwObserved, present],
  )

  const handleHeldChanged = useCallback(
    (message: DiceHoldChangedMessage) => {
      if (
        message.roomId === roomId &&
        message.payload.roundNumber === roundNumber &&
        message.payload.playerId === activePlayerId &&
        message.payload.playerId !== you
      ) {
        dispatch({ type: 'heldSynced', held: message.payload.held as HeldDice })
      }
    },
    [activePlayerId, dispatch, roomId, roundNumber, you],
  )

  const handleError = useCallback(
    (message: ErrorMessage) => {
      const pending = tracking.pending
      if (!pending || message.payload.refMsgId !== pending.msgId) return
      tracking.settle()
      present({ type: 'requestFailed' })
      showToast(turnAwareErrorMessage(message.payload))
    },
    [showToast, tracking.settle, tracking.pending, present],
  )

  useEffect(
    () =>
      realtimeClient.onMessage((message) => {
        switch (message.type) {
          case 'game.yacht_dice.dice.broadcast':
            return handleBroadcast(message)
          case 'game.yacht_dice.dice.shaken':
            return handleShaken(message)
          case 'game.yacht_dice.dice.thrown':
            return handleThrown(message)
          case 'game.yacht_dice.dice.hold_changed':
            return handleHeldChanged(message)
          case 'error':
            return handleError(message)
        }
      }),
    [handleBroadcast, handleError, handleHeldChanged, handleShaken, handleThrown, realtimeClient],
  )
}
