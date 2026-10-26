import { type RefObject, useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react'
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
import {
  IDLE_ROLL_PRESENTATION,
  type RollPresentation,
  rollPresentationReducer,
} from './roll/presentation'
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

/**
 * 이 화면이 들고 있는 로컬 굴림 판. 서버가 준 굴림 상태에서 복원하고, 라운드가 바뀌면
 * 렌더 중에 새 판으로 갈아 끼운다.
 */
function useLocalRollGame(game: GameState | undefined, roundNumber: number) {
  const [local, setLocal] = useState(() =>
    restoreYachtGame(Date.now() >>> 0, roundNumber, {
      rollCount: game?.rollCount ?? 0,
      dice: game?.dice ?? null,
      held: game?.held ?? null,
    }),
  )

  const resetLocalFor = useCallback(
    (round: number) => setLocal((state) => createYachtGame(state.seed, round)),
    [],
  )

  if (local.roundNumber !== roundNumber) resetLocalFor(roundNumber)

  const dispatch = useCallback((action: YachtGameAction) => {
    setLocal((state) => yachtGameReducer(state, action))
  }, [])

  return { dispatch, local, resetLocalFor, setLocal }
}

/**
 * 굴림 연출 상태와, 메시지 처리기·콜백이 읽는 최신값 ref. ref는 렌더가 커밋된 뒤에
 * 갱신하므로 처리기는 마지막으로 그려진 판과 입력 방식을 본다.
 */
function useRollPresentation(game: GameState | undefined) {
  const renderedGameRef = useRef(game)
  const [presentation, present] = useReducer(rollPresentationReducer, IDLE_ROLL_PRESENTATION)
  const trackingRef = useRef(createRollTracking())
  const inputModeRef = useRef(presentation.inputMode)
  useLayoutEffect(() => {
    renderedGameRef.current = game
    inputModeRef.current = presentation.inputMode
  })
  return { inputModeRef, present, presentation, renderedGameRef, tracking: trackingRef.current }
}

type RollRequestOptions = Parameters<typeof useRollRequest>[0]
type RollIncomingOptions = Parameters<typeof useRollIncoming>[0]

/**
 * 서버 왕복 — 굴림 요청을 보내고, 돌아온 결과·남의 굴림 신호를 로컬 판에 반영한다.
 * currentGame은 렌더된 판과 스토어의 최신 스냅숏 중 라운드가 앞선 쪽을 고른다.
 */
function useRollServerFlow({
  canRoll,
  inputModeRef,
  local,
  renderedGameRef,
  ...incoming
}: Omit<RollIncomingOptions, 'currentGame'> &
  Pick<RollRequestOptions, 'canRoll' | 'inputModeRef' | 'local'> & {
    renderedGameRef: RefObject<GameState | undefined>
  }) {
  const realtimeClient = useRealtimeClient()
  const { present, roomId, roundNumber, showToast, tracking } = incoming
  const beginRoll = useRollRequest({
    canRoll,
    inputModeRef,
    local,
    present,
    realtimeClient,
    roomId,
    roundNumber,
    showToast,
    tracking,
  })

  useRollIncoming({
    ...incoming,
    currentGame: () =>
      latestGameState(renderedGameRef.current, useAppStore.getState().roomSnapshot?.game),
  })
  return beginRoll
}

type RollGestureOptions = Parameters<typeof useRollGesture>[0]
type DiceActionsOptions = Parameters<typeof useDiceActions>[0]

/**
 * 플레이어가 직접 하는 조작. 굴리는 두 길 — 흔들기(모션)와 탭 — 은 결국 같은 beginRoll로
 * 모이고, 킵·던짐·완료는 useDiceActions가 맡는다. 굴림이 끝나면 제스처 인식기를 되돌린다.
 */
function useRollControls({
  canPlay,
  rollInputMode,
  activeBoard,
  canHold,
  dispatch,
  isMyTurn,
  publishHeld,
  releaseRequestId,
  ...gesture
}: RollGestureOptions &
  Omit<DiceActionsOptions, 'pendingRoll' | 'resetGesture'> & {
    canPlay: boolean
    rollInputMode: RollPresentation['inputMode']
  }) {
  const { beginRoll, feedback, local, present, publishThrow } = gesture
  const handleGestureEvent = useRollGesture(gesture)
  const motion = useMotionRollInput(handleGestureEvent, canPlay)
  const pendingRoll = getPendingRoll(local)

  useTapRelease({ local, present, publishThrow, rollInputMode })

  const roll = useCallback(() => beginRoll('tap'), [beginRoll])

  const actions = useDiceActions({
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
  return { ...actions, motion, pendingRoll, roll }
}

export function useGamePlayRoll({ canPlay, game, roomId, showToast, you }: UseGamePlayRollOptions) {
  const connectionStatus = useAppStore((state) => state.connectionStatus)

  const roundNumber = game?.roundNumber ?? 1
  const activePlayerId = game?.activePlayerId
  const isMyTurn = activePlayerId === you
  const activeBoard = activePlayerId ? game?.scores[activePlayerId] : undefined

  const { dispatch, local, resetLocalFor, setLocal } = useLocalRollGame(game, roundNumber)
  const { inputModeRef, present, presentation, renderedGameRef, tracking } =
    useRollPresentation(game)
  const {
    inputMode: rollInputMode,
    releaseRequestId,
    remoteShaking,
    requesting: requestingRoll,
  } = presentation
  const feedback = useRollFeedback()

  useTurnReset({ activePlayerId, present, resetLocalFor, roundNumber, tracking })

  const availability = rollAvailabilityOf({ connectionStatus, isMyTurn, local, requestingRoll })
  const { canHold, canRoll } = availability

  const { publishHeld, publishShake, publishThrow } = useRollBroadcast(roomId, roundNumber)

  const beginRoll = useRollServerFlow({
    activePlayerId,
    canRoll,
    dispatch,
    feedback,
    inputModeRef,
    local,
    present,
    publishThrow,
    renderedGameRef,
    roomId,
    roundNumber,
    setLocal,
    showToast,
    tracking,
    you,
  })

  // completeRoll · confirmThrow · motion · pendingRoll · releaseAll · roll · toggleHeld
  const controls = useRollControls({
    activeBoard,
    beginRoll,
    canHold,
    canPlay,
    dispatch,
    feedback,
    inputModeRef,
    isMyTurn,
    local,
    present,
    publishHeld,
    publishShake,
    publishThrow,
    releaseRequestId,
    rollInputMode,
    tracking,
  })

  return {
    ...availability,
    ...controls,
    canPlay,
    dispatch,
    local,
    feedback,
    releaseRequestId,
    remoteShaking,
    rollInputMode,
  }
}

export type GamePlayRoll = ReturnType<typeof useGamePlayRoll>
