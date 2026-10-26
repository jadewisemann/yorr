import { useCallback, useEffect, useMemo } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { GameState, PlayerId, ServerMessage } from '@/realtime/wsEvents'
import type { HeldDice } from '@/yacht/domain/dice'
import type { YachtGameAction, YachtGameState } from '@/yacht/domain/yachtGame'
import { animationSeedForRoll, rollAnimationMode } from './animation'
import { applyBroadcast, isRemoteHoldChange, isRemoteShake, isRemoteThrow } from './incomingChecks'
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

/**
 * 굴림 결과 broadcast. 내 굴림이면 보낸 요청과 짝을 맞춰 입력 방식대로 연출하고, 남의
 * 굴림이면 원격 연출로 받는다. 어느 쪽이든 로컬 판은 서버가 정한 눈으로 맞춘다.
 */
function useBroadcastHandler(
  options: Pick<
    UseRollIncomingOptions,
    | 'currentGame'
    | 'present'
    | 'publishThrow'
    | 'roomId'
    | 'setLocal'
    | 'showToast'
    | 'tracking'
    | 'you'
  >,
) {
  const { currentGame, present, publishThrow, roomId, setLocal, showToast, tracking, you } = options

  return useCallback(
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
      const seed = animationSeedForRoll({
        roomId,
        playerId: message.payload.playerId,
        roundNumber: message.payload.roundNumber,
        rollCount: message.payload.rollCount,
        dice: message.payload.dice,
      })
      setLocal(applyBroadcast(message, { forced, requestId, seed }))
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
}

/** 남의 턴에 오는 흔들기·던지기·킵 신호. 지금 굴리는 사람의 것만 받는다. */
function useRemoteSignalHandlers(
  options: Pick<
    UseRollIncomingOptions,
    | 'activePlayerId'
    | 'dispatch'
    | 'feedback'
    | 'present'
    | 'roomId'
    | 'roundNumber'
    | 'tracking'
    | 'you'
  >,
) {
  const { activePlayerId, dispatch, feedback, present, roomId, roundNumber, tracking, you } =
    options

  // 콜백 의존성에 그대로 들어가므로 렌더마다 새 객체를 만들면 매번 리스너를 다시 건다.
  const remoteContext = useMemo(
    () => ({ activePlayerId, roomId, roundNumber, you }),
    [activePlayerId, roomId, roundNumber, you],
  )

  const handleShaken = useCallback(
    (message: DiceShakenMessage) => {
      if (!isRemoteShake(message, remoteContext, tracking.remote.rolling)) return
      present({ type: 'remoteShakeStarted' })
      feedback.pulse(message.payload.direction, message.payload.strength, 'remote')
    },
    [feedback.pulse, remoteContext, tracking.remote.rolling, present],
  )

  const handleThrown = useCallback(
    (message: DiceThrownMessage) => {
      if (!isRemoteThrow(message, remoteContext)) return
      const releaseNow = tracking.remote.throwObserved({
        rollCount: message.payload.rollCount,
        roundNumber: message.payload.roundNumber,
      })
      if (releaseNow) present({ type: 'released', requestId: releaseNow })
    },
    [remoteContext, tracking.remote.throwObserved, present],
  )

  const handleHeldChanged = useCallback(
    (message: DiceHoldChangedMessage) => {
      if (!isRemoteHoldChange(message, remoteContext)) return
      dispatch({ type: 'heldSynced', held: message.payload.held as HeldDice })
    },
    [dispatch, remoteContext],
  )

  return { handleHeldChanged, handleShaken, handleThrown }
}

/**
 * 서버가 보내는 굴림 관련 메시지를 로컬 판·연출·추적기에 잇는다.
 * "이 메시지가 이 화면의 것인가"는 [`incomingChecks`](./incomingChecks.ts)가 판정한다.
 */
export function useRollIncoming(options: UseRollIncomingOptions) {
  const { present, showToast, tracking } = options
  const realtimeClient = useRealtimeClient()

  const handleBroadcast = useBroadcastHandler(options)
  const { handleHeldChanged, handleShaken, handleThrown } = useRemoteSignalHandlers(options)

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
