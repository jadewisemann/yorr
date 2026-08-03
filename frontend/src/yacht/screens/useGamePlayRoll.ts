import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import {
  buildClientMessage,
  type GameState,
  type PlayerId,
  type ServerMessage,
} from '@/realtime/wsEvents'
import { readSoundMuted } from '@/shared/audio/soundPreference'
import { useAppStore } from '@/store'
import {
  type DiceIndex,
  type DiceSet,
  type HeldDice,
  NO_HELD_DICE,
  toggleHeldDie,
} from '@/yacht/domain/dice'
import { detectSpecialHand, type SpecialHand } from '@/yacht/domain/specialHands'
import {
  createYachtGame,
  getPendingRoll,
  MAX_ROLLS,
  restoreYachtGame,
  type YachtGameAction,
  yachtGameReducer,
} from '@/yacht/domain/yachtGame'
import { createRollFeedback } from '@/yacht/feedback/createRollFeedback'
import { createHandVoice, type HandVoice } from '@/yacht/feedback/handVoice'
import type { MotionGestureEvent } from '@/yacht/input/motionTypes'
import { useMotionRollInput } from '@/yacht/input/useMotionRollInput'
import type { PhysicsDiceMotionPulse, PhysicsDicePhase } from '@/yacht/rendering/physics-dice/types'
import { isRecorded } from '@/yacht/yachtCategoryView'
import {
  animationSeedForRoll,
  isCurrentDiceBroadcast,
  latestGameState,
  type RollAnimationMode,
  type RollInputMode,
  rollAnimationMode,
  turnAwareErrorMessage,
} from './gamePlayModel'

const TAP_RELEASE_DELAY_MS = 600
const SHAKE_RELAY_INTERVAL_MS = 60

type DiceBroadcastMessage = Extract<ServerMessage, { type: 'dice.broadcast' }>
type DiceShakenMessage = Extract<ServerMessage, { type: 'dice.shaken' }>
type DiceThrownMessage = Extract<ServerMessage, { type: 'dice.thrown' }>
type DiceHoldChangedMessage = Extract<ServerMessage, { type: 'dice.hold_changed' }>
type ErrorMessage = Extract<ServerMessage, { type: 'error' }>
interface PendingRollRequest {
  inputMode: RollInputMode
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

interface UseGamePlayRollOptions {
  game: GameState | undefined
  roomId: string
  showToast: (message: string) => void
  you: PlayerId
}

export function useGamePlayRoll({ game, roomId, showToast, you }: UseGamePlayRollOptions) {
  const realtimeClient = useRealtimeClient()
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const renderedGameRef = useRef(game)
  renderedGameRef.current = game

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
  const [releaseRequestId, setReleaseRequestId] = useState<string | null>(null)
  const [rollInputMode, setRollInputMode] = useState<RollAnimationMode | null>(null)
  const [requestingRoll, setRequestingRoll] = useState(false)
  const [motionPulse, setMotionPulse] = useState<PhysicsDiceMotionPulse | null>(null)
  const [remoteShaking, setRemoteShaking] = useState(false)
  const [rollHighlight, setRollHighlight] = useState<{ hand: SpecialHand; id: number } | null>(null)

  const acceptedRollTurnRef = useRef<{ playerId: PlayerId; roundNumber: number } | null>(null)
  const activePlayerRef = useRef(activePlayerId)
  const motionPulseSequenceRef = useRef(0)
  const lastShakeSentAtRef = useRef(0)
  const rollSequenceRef = useRef(0)
  const inputModeRef = useRef(rollInputMode)
  const pendingRollRequestRef = useRef<PendingRollRequest | null>(null)
  const queuedMotionReleaseRef = useRef(false)
  const remoteRollRef = useRef<{
    requestId: string
    rollCount: number
    roundNumber: number
  } | null>(null)
  const queuedRemoteReleaseRef = useRef<{ rollCount: number; roundNumber: number } | null>(null)
  const feedbackRef = useRef<ReturnType<typeof createRollFeedback> | null>(null)
  const handVoiceRef = useRef<HandVoice | null>(null)
  inputModeRef.current = rollInputMode
  if (!feedbackRef.current) feedbackRef.current = createRollFeedback({ muted: readSoundMuted() })

  if (local.roundNumber !== roundNumber) setLocal(createYachtGame(local.seed, roundNumber))

  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    const acceptedRollTurn = acceptedRollTurnRef.current
    acceptedRollTurnRef.current = null
    if (
      acceptedRollTurn?.playerId !== activePlayerId ||
      acceptedRollTurn?.roundNumber !== roundNumber
    ) {
      setLocal((state) => createYachtGame(state.seed, roundNumber))
    }
    setReleaseRequestId(null)
    setRollInputMode(null)
    setRequestingRoll(false)
    setRemoteShaking(false)
    pendingRollRequestRef.current = null
    queuedMotionReleaseRef.current = false
    remoteRollRef.current = null
    queuedRemoteReleaseRef.current = null
  }, [activePlayerId, roundNumber])

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

  const publishHeld = useCallback(
    (held: HeldDice) => {
      try {
        realtimeClient.send(buildClientMessage('dice.hold', { held, roundNumber }, { roomId }))
      } catch {
        // ConnectionBanner owns transport failure feedback.
      }
    },
    [realtimeClient, roomId, roundNumber],
  )

  const publishShake = useCallback(
    (direction: 'left' | 'right', strength: number) => {
      const now = performance.now()
      if (now - lastShakeSentAtRef.current < SHAKE_RELAY_INTERVAL_MS) return
      lastShakeSentAtRef.current = now
      try {
        realtimeClient.send(
          buildClientMessage('dice.shake', { direction, roundNumber, strength }, { roomId }),
        )
      } catch {
        // ConnectionBanner owns transport failure feedback.
      }
    },
    [realtimeClient, roomId, roundNumber],
  )

  const publishThrow = useCallback(
    (rollCount: number) => {
      try {
        realtimeClient.send(
          buildClientMessage(
            'dice.throw',
            { rollCount: rollCount as 1 | 2 | 3, roundNumber },
            { roomId },
          ),
        )
      } catch {
        // A lost presentation signal must not block the game.
      }
    },
    [realtimeClient, roomId, roundNumber],
  )

  const beginRoll = useCallback(
    (inputMode: RollInputMode) => {
      if (!canRoll) return
      rollSequenceRef.current += 1
      const requestId = `r${roundNumber}-${rollSequenceRef.current}`
      const msgId = `roll-${roundNumber}-${local.rollCount + 1}-${Date.now()}`
      setReleaseRequestId(null)
      setRollInputMode(inputMode)
      inputModeRef.current = inputMode
      setRequestingRoll(true)
      queuedMotionReleaseRef.current = false
      pendingRollRequestRef.current = { inputMode, msgId, requestId }
      try {
        realtimeClient.send(
          buildClientMessage(
            'dice.roll',
            {
              held: local.held,
              rollCount: (local.rollCount + 1) as 1 | 2 | 3,
              roundNumber,
            },
            { roomId, msgId },
          ),
        )
      } catch {
        pendingRollRequestRef.current = null
        setRequestingRoll(false)
        setRollInputMode(null)
        showToast('주사위를 요청하지 못했어요. 연결 상태를 확인해 주세요.')
      }
    },
    [canRoll, local.held, local.rollCount, realtimeClient, roomId, roundNumber, showToast],
  )

  const handleBroadcast = useCallback(
    (message: DiceBroadcastMessage) => {
      const currentGame = latestGameState(
        renderedGameRef.current,
        useAppStore.getState().roomSnapshot?.game,
      )
      if (!isCurrentDiceBroadcast(message, roomId, currentGame)) return
      const ownRoll = message.payload.playerId === you
      const forced = message.payload.auto === true
      const pending = pendingRollRequestRef.current
      const requestId = `roll-${message.payload.playerId}-${message.payload.roundNumber}-${message.payload.rollCount}`
      const animationMode = rollAnimationMode({
        forced,
        ownRoll,
        pendingInputMode: pendingInputModeFor(message, ownRoll, forced, pending),
      })
      remoteRollRef.current =
        animationMode === 'remote'
          ? {
              requestId,
              rollCount: message.payload.rollCount,
              roundNumber: message.payload.roundNumber,
            }
          : null
      pendingRollRequestRef.current = null
      setRequestingRoll(false)
      setReleaseRequestId(null)
      setRollInputMode(animationMode)
      setRemoteShaking(false)
      acceptedRollTurnRef.current = {
        playerId: message.payload.playerId,
        roundNumber: message.payload.roundNumber,
      }
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
      if (ownRoll && queuedMotionReleaseRef.current) {
        queuedMotionReleaseRef.current = false
        setReleaseRequestId(requestId)
        publishThrow(message.payload.rollCount)
      }
      const queuedRemote = queuedRemoteReleaseRef.current
      if (
        animationMode === 'remote' &&
        queuedRemote?.roundNumber === message.payload.roundNumber &&
        queuedRemote.rollCount === message.payload.rollCount
      ) {
        queuedRemoteReleaseRef.current = null
        setReleaseRequestId(requestId)
      }
    },
    [publishThrow, roomId, showToast, you],
  )

  const handleShaken = useCallback(
    (message: DiceShakenMessage) => {
      if (
        message.roomId !== roomId ||
        message.payload.roundNumber !== roundNumber ||
        message.payload.playerId !== activePlayerId ||
        message.payload.playerId === you ||
        !remoteRollRef.current
      ) {
        return
      }
      feedbackRef.current?.remoteShakePulse()
      setRemoteShaking(true)
      motionPulseSequenceRef.current += 1
      setMotionPulse({
        id: motionPulseSequenceRef.current,
        direction: message.payload.direction,
        strength: message.payload.strength,
      })
    },
    [activePlayerId, roomId, roundNumber, you],
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
      const remote = remoteRollRef.current
      if (
        remote?.roundNumber === message.payload.roundNumber &&
        remote.rollCount === message.payload.rollCount
      ) {
        remoteRollRef.current = null
        setReleaseRequestId(remote.requestId)
        return
      }
      queuedRemoteReleaseRef.current = {
        rollCount: message.payload.rollCount,
        roundNumber: message.payload.roundNumber,
      }
    },
    [activePlayerId, roomId, roundNumber, you],
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
      const pending = pendingRollRequestRef.current
      if (!pending || message.payload.refMsgId !== pending.msgId) return
      pendingRollRequestRef.current = null
      setRequestingRoll(false)
      setRollInputMode(null)
      showToast(turnAwareErrorMessage(message.payload))
    },
    [showToast],
  )

  useEffect(
    () =>
      realtimeClient.onMessage((message) => {
        switch (message.type) {
          case 'dice.broadcast':
            return handleBroadcast(message)
          case 'dice.shaken':
            return handleShaken(message)
          case 'dice.thrown':
            return handleThrown(message)
          case 'dice.hold_changed':
            return handleHeldChanged(message)
          case 'error':
            return handleError(message)
        }
      }),
    [handleBroadcast, handleError, handleHeldChanged, handleShaken, handleThrown, realtimeClient],
  )

  const handleGestureEvent = useCallback(
    (event: MotionGestureEvent) => {
      switch (event.type) {
        case 'shakePulse':
          feedbackRef.current?.shakePulse(event.direction, event.strength)
          motionPulseSequenceRef.current += 1
          setMotionPulse({
            id: motionPulseSequenceRef.current,
            direction: event.direction,
            strength: event.strength,
          })
          publishShake(event.direction, event.strength)
          return
        case 'shakeStarted':
          feedbackRef.current?.armed()
          beginRoll('motion')
          return
        case 'throwDetected': {
          const request = getPendingRoll(local)
          if (inputModeRef.current !== 'motion') return
          if (!request) {
            if (pendingRollRequestRef.current?.inputMode === 'motion') {
              queuedMotionReleaseRef.current = true
            }
            return
          }
          feedbackRef.current?.thrown()
          setReleaseRequestId(request.requestId)
          publishThrow(local.rollCount)
          return
        }
        case 'shakeArmed':
        case 'gestureCancelled':
          return
      }
    },
    [beginRoll, local, publishShake, publishThrow],
  )

  const motion = useMotionRollInput(handleGestureEvent)
  const pendingRoll = getPendingRoll(local)

  useEffect(() => {
    if (!pendingRoll || (rollInputMode !== 'tap' && rollInputMode !== 'auto')) return
    const timeout = setTimeout(() => {
      setReleaseRequestId(pendingRoll.requestId)
      if (rollInputMode === 'tap') publishThrow(local.rollCount)
    }, TAP_RELEASE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [local.rollCount, pendingRoll, publishThrow, rollInputMode])

  useEffect(() => () => feedbackRef.current?.dispose(), [])

  useEffect(() => {
    const voice = createHandVoice({ muted: readSoundMuted() })
    handVoiceRef.current = voice
    return () => {
      voice.dispose()
      handVoiceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (rollHighlight) handVoiceRef.current?.play(rollHighlight.hand)
  }, [rollHighlight])

  const roll = useCallback(() => beginRoll('tap'), [beginRoll])

  const confirmThrow = useCallback(() => {
    if (!pendingRoll || releaseRequestId === pendingRoll.requestId) return
    feedbackRef.current?.thrown()
    setReleaseRequestId(pendingRoll.requestId)
    publishThrow(local.rollCount)
  }, [local.rollCount, pendingRoll, publishThrow, releaseRequestId])

  const completeRoll = useCallback(
    (requestId: string, _dice: DiceSet) => {
      const completedDice = pendingRoll?.requestId === requestId ? pendingRoll.targetDice : null
      if (!completedDice) return
      dispatch({ type: 'rollCompleted', requestId, dice: completedDice })
      setReleaseRequestId(null)
      setRollInputMode(null)
      if (isMyTurn) motion.resetGesture('roll-complete')
      const hand = detectSpecialHand(completedDice)
      if (hand && !isRecorded(activeBoard?.categories[hand])) {
        setRollHighlight({ hand, id: Date.now() })
      }
    },
    [activeBoard, dispatch, isMyTurn, motion, pendingRoll],
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
    canPick,
    canRoll,
    completeRoll,
    confirmThrow,
    currentRollNumber,
    dispatch,
    dismissRollHighlight: () => setRollHighlight(null),
    lastRollInPlay,
    keptCount,
    local,
    motion,
    motionPulse,
    onDiceImpact: (index: DiceIndex, strength: number) =>
      feedbackRef.current?.diceImpact(index, strength),
    onPhysicsError: () => feedbackRef.current?.error(),
    onPhysicsPhaseChange: (phase: PhysicsDicePhase) => feedbackRef.current?.phaseChanged(phase),
    pendingRoll,
    releaseAll,
    releaseRequestId,
    remoteShaking,
    roll,
    rollHighlight,
    rollInputMode,
    rolling,
    rollsLeft,
    settledRollCount,
    setMuted: (muted: boolean) => {
      feedbackRef.current?.setMuted(muted)
      handVoiceRef.current?.setMuted(muted)
    },
    submitting,
    submitted,
    toggleHeld,
  }
}

export type GamePlayRoll = ReturnType<typeof useGamePlayRoll>
