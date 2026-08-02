import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/cn'
import { Button } from '@/components/Button'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { GameHelpModal } from '@/components/GameHelpModal'
import { Modal } from '@/components/Modal'
import { MotionPermissionPanel } from '@/components/MotionPermissionPanel'
import { PhysicsDiceScene } from '@/components/PhysicsDiceScene'
import { RecordPanel } from '@/components/RecordPanel'
import { RollCounter } from '@/components/RollCounter'
import { EffectCallout, RollResultCallout } from '@/components/RollResultCallout'
import { RoundTimer } from '@/components/RoundTimer'
import { ScoreSheet } from '@/components/ScoreSheet'
import { ToastHost, useToast } from '@/components/ToastHost'
import { Tooltip } from '@/components/Tooltip'
import { TurnStrip } from '@/components/TurnStrip'
import { TutorialGuide } from '@/components/TutorialGuide'
import {
  type DiceIndex,
  type DiceSet,
  type HeldDice,
  NO_HELD_DICE,
  toggleHeldDie,
} from '@/domain/dice'
import {
  type CategoryScores,
  calculateScoreCandidates,
  YACHT_CATEGORIES,
  type YachtCategory,
} from '@/domain/scoring'
import { detectSpecialHand, type SpecialHand } from '@/domain/specialHands'
import {
  createYachtGame,
  getPendingRoll,
  restoreYachtGame,
  type YachtGameAction,
  yachtGameReducer,
} from '@/domain/yachtGame'
import { createRollFeedback } from '@/feedback/createRollFeedback'
import { createHandVoice, type HandVoice } from '@/feedback/handVoice'
import type { MotionAvailability, MotionGestureEvent } from '@/input/motionTypes'
import type { RollInputMode } from '@/input/RollIntent'
import { useMotionRollInput } from '@/input/useMotionRollInput'
import { setSoundtrackMuted } from '@/landingSoundtrack'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { buildClientMessage } from '@/realtime/wsEvents'
import type { PhysicsDiceMotionPulse } from '@/rendering/physics-dice/types'
import { readSoundMuted, saveSoundMuted } from '@/soundPreference'
import { type ActiveRoomSession, useAppStore } from '@/store'
import { hideTutorial, isTutorialHidden } from '@/tutorialPreference'
import { useCountdown } from '@/useCountdown'
import { useMediaQuery } from '@/useMediaQuery'
import { categoryLabel, categoryShortLabel, isRecorded } from '@/yachtCategoryView'
import {
  animationSeedForRoll,
  isCurrentDiceBroadcast,
  latestGameState,
  newlyRecordedCategory,
  type RollAnimationMode,
  rollAnimationMode,
  toMatrixPlayers,
  toTurnStripPlayers,
  turnAwareErrorMessage,
} from './gamePlayModel'

/** 이 폭부터 점수표를 시트 대신 좌측 상시 패널로 승격한다(와이어프레임 1c). */
const WIDE_LAYOUT = '(min-width: 1024px)'
const TOTAL_ROUNDS = 12
const MAX_ROLLS = 3
const TAP_RELEASE_DELAY_MS = 600
/**
 * 흔들림 펄스를 방에 중계하는 최소 간격. 펄스는 방향이 바뀔 때마다 나와 초당 열 번을 넘길 수
 * 있는데, 관전 화면에는 "지금 흔들고 있다/멈췄다"가 보이면 충분하다. 이 간격은 사발 세기가
 * 감쇠로 잦아드는 시간보다 짧아야 흔드는 동안 사발이 끊겨 보이지 않는다.
 */
const SHAKE_RELAY_INTERVAL_MS = 60
interface GamePlayProps {
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
  /** 헤더의 '나가기'가 눌리면 부모(GamePage)가 확인 모달을 연다. */
  onLeaveRequest: () => void
}

export function GamePlay({ onLeaveRequest, roomId, session, snapshot }: GamePlayProps) {
  const wide = useMediaQuery(WIDE_LAYOUT)
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const realtimeClient = useRealtimeClient()
  const { message: toastMessage, showToast } = useToast()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [zeroConfirm, setZeroConfirm] = useState<YachtCategory | null>(null)
  const [releaseRequestId, setReleaseRequestId] = useState<string | null>(null)
  const [rollInputMode, setRollInputMode] = useState<RollAnimationMode | null>(null)
  const [requestingRoll, setRequestingRoll] = useState(false)
  const [motionPulse, setMotionPulse] = useState<PhysicsDiceMotionPulse | null>(null)
  const motionPulseSequenceRef = useRef(0)
  /**
   * 관전 중인 굴림이 "기기를 흔들어서" 굴려지고 있다 — dice.shaken을 한 번이라도 받으면 켜진다.
   * 켜지면 내 사발도 정해진 애니메이션 대신 중계된 펄스만 따라간다(굴린 사람이 손을 멈추면 같이 멈춘다).
   * 버튼으로 굴리는 사람에게선 펄스가 오지 않으므로 그때는 꺼진 채로 남아 기존 애니메이션이 돈다.
   */
  const [remoteShaking, setRemoteShaking] = useState(false)
  const lastShakeSentAtRef = useRef(0)
  const [submitting, setSubmitting] = useState(false)
  // 굴림마다 id를 새로 발급해 같은 족보가 연속으로 떠도 리마운트되게 한다.
  const [rollHighlight, setRollHighlight] = useState<{ hand: SpecialHand; id: number } | null>(null)
  // 내 차례 시작 콜아웃 — 토스트보다 눈에 띄는 족보 이펙트와 같은 연출로 알린다. id = 리마운트 키.
  const [turnCallout, setTurnCallout] = useState<number | null>(null)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)
  const pendingSubmissionRef = useRef<{
    category: YachtCategory
    msgId: string
  } | null>(null)
  const acceptedRollTurnRef = useRef<{ playerId: string; roundNumber: number } | null>(null)
  // 닫은 안내가 "어느 상태의 안내였는지"를 담는다. boolean으로 두면 상태가 바뀌어도 계속 닫혀
  // 새 안내를 놓친다 — 값이 달라지는 순간 자동으로 다시 뜨게 하려는 의도다.
  const [dismissedNotice, setDismissedNotice] = useState<MotionAvailability | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  // 첫 진입 코치마크. "다시 보지 않기"는 쿠키로 영구 숨김, 그냥 닫으면 이번 판만 닫힌다.
  const [tutorialOpen, setTutorialOpen] = useState(() => !isTutorialHidden())

  const game = snapshot.game
  const renderedGameRef = useRef(game)
  renderedGameRef.current = game
  const roundNumber = game?.roundNumber ?? 1
  const activePlayerId = game?.activePlayerId
  const isMyTurn = activePlayerId === session.you
  const activePlayer = snapshot.players.find((player) => player.playerId === activePlayerId)
  const remainingMs = useCountdown(game?.roundDeadline ?? null)
  const myBoard = game?.scores[session.you]
  const activeBoard = activePlayerId ? game?.scores[activePlayerId] : undefined

  // 마운트 시점의 굴림 진행은 서버 스냅샷에서 되살린다. 턴 중간에 새로고침·재접속하면
  // 0부터 세기 시작해 다음 dice.roll이 서버의 activeRollCount와 어긋난다(INVALID_ROLL).
  const [local, setLocal] = useState(() =>
    restoreYachtGame(Date.now() >>> 0, roundNumber, {
      rollCount: game?.rollCount ?? 0,
      dice: game?.dice ?? null,
      held: game?.held ?? null,
    }),
  )
  // 서버가 다음 라운드로 넘기면 로컬 굴림 상태를 새로 시작한다.
  if (local.roundNumber !== roundNumber) setLocal(createYachtGame(local.seed, roundNumber))

  const activePlayerRef = useRef(activePlayerId)
  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    const acceptedRollTurn = acceptedRollTurnRef.current
    acceptedRollTurnRef.current = null
    const alreadyAppliedNextTurnRoll =
      acceptedRollTurn?.playerId === activePlayerId && acceptedRollTurn?.roundNumber === roundNumber
    if (!alreadyAppliedNextTurnRoll) {
      setLocal((state) => createYachtGame(state.seed, roundNumber))
    }
    setReleaseRequestId(null)
    setRollInputMode(null)
    setRequestingRoll(false)
    setRemoteShaking(false)
    setSubmitting(false)
    setZeroConfirm(null)
    pendingSubmissionRef.current = null
    pendingRollRequestRef.current = null
    queuedMotionReleaseRef.current = false
    // 지난 턴의 사발은 이미 치워졌다 — 늦게 도착한 dice.thrown이 새 굴림을 쏟으면 안 된다.
    remoteRollRef.current = null
    queuedRemoteReleaseRef.current = null
    // 남의 턴을 구경하며 열어둔 점수시트가 턴이 넘어간 뒤에도 남아있으면 안 된다(QA FND-5).
    setSheetOpen(false)
  }, [activePlayerId, roundNumber])

  const dispatch = useCallback((action: YachtGameAction) => {
    setLocal((state) => yachtGameReducer(state, action))
  }, [])

  const usedCategories = YACHT_CATEGORIES.filter((category) =>
    isRecorded(activeBoard?.categories[category]),
  )
  const candidates: CategoryScores = local.dice
    ? calculateScoreCandidates(local.dice, usedCategories)
    : {}

  // 재연결 중에는 조작을 잠근다. 서버 상태와 어긋난 굴림·확정이 가장 위험하다.
  const locked = connectionStatus === 'reconnecting' || connectionStatus === 'closed' || !isMyTurn
  const submitted = local.phase === 'roundComplete'
  const rollsLeft = MAX_ROLLS - local.rollCount
  // 킵 레일(트레이 하단 밴드) 라벨 — 위치가 곧 킵 표시이므로 개수·합만 조용히 병기한다.
  const keptCount = local.held.filter(Boolean).length
  // 다섯 개를 전부 킵하면 굴릴 주사위가 0개다(QA S15P11A406-102).
  const allKept = local.dice !== null && keptCount === 5
  const canRoll =
    !locked &&
    !submitted &&
    !requestingRoll &&
    !allKept &&
    rollsLeft > 0 &&
    (local.phase === 'ready' || local.phase === 'choosing')
  const rolling = local.phase === 'rolling' || requestingRoll
  // 기록은 점수표·퀵 칩을 탭하는 원큐 흐름이다(디자인 Yacht Play Screens). CTA는 굴리기 하나만 남는다.
  const canPick = !locked && !submitting && local.phase === 'choosing'
  // 내 턴이 아니면 트레이는 관전 화면이다. 여기서 홀드를 토글하면 서버가 모르는 킵이 생겨
  // 다음 굴림·마감 자동 굴림이 화면과 다르게 동작한다.
  const canHold = !locked && !submitted && local.phase === 'choosing' && local.rollCount < MAX_ROLLS
  // rollCount는 서버 브로드캐스트 시점에 올라간다 — 마지막 굴림이 날아가는 중에도 이미
  // MAX_ROLLS라, 그 굴림의 정렬부터 킵 주사위까지 한 줄로 눕는다(S15P11A406-94).
  const lastRollInPlay = local.rollCount >= MAX_ROLLS
  // 굴리는 중이면 rollCount가 곧 그 굴림의 번호고, 멈춘 상태면 다음에 굴릴 번호를 보여준다.
  const currentRollNumber =
    local.phase === 'rolling' ? local.rollCount : Math.min(MAX_ROLLS, local.rollCount + 1)
  // 굴림 카운터는 "끝난 굴림"만 센다. 날아가는 중인 굴림을 미리 채우면 착지 전에 소진돼 보인다.
  const settledRollCount = local.phase === 'rolling' ? local.rollCount - 1 : local.rollCount

  // 디자인의 한 장 점수시트 — 모든 플레이어를 열로 눕힌다. 내 열이 항상 첫 번째다.
  const sheetPlayers = toMatrixPlayers(snapshot.players, game?.scores, session.you)
  const leader = sheetPlayers.reduce(
    (best, player) =>
      (player.scoreboard?.total ?? 0) > (best?.scoreboard?.total ?? 0) ? player : best,
    sheetPlayers[0],
  )
  const leaderLabel = leader ? `${leader.nickname} · ${leader.scoreboard?.total ?? 0}` : '—'

  const diceRef = useRef(local.dice)
  diceRef.current = local.dice

  const submitCategory = useCallback(
    (category: YachtCategory) => {
      const dice = diceRef.current
      if (!dice) return
      const msgId = `round-${roundNumber}-${Date.now()}`
      dispatch({ type: 'categorySelected', category })
      dispatch({ type: 'submissionStarted' })
      pendingSubmissionRef.current = { category, msgId }
      setSubmitting(true)
      try {
        realtimeClient.send(
          buildClientMessage('round.submit', { category, dice, roundNumber }, { roomId, msgId }),
        )
      } catch {
        pendingSubmissionRef.current = null
        dispatch({ type: 'submissionFailed' })
        setSubmitting(false)
        showToast('점수를 기록하지 못했어요. 다시 시도해 주세요.')
      }
    },
    [dispatch, realtimeClient, roomId, roundNumber, showToast],
  )

  // 서버 마감 처리로 점수가 들어왔을 때 "무엇이 기록됐는지"를 알리기 위해 직전 점수판을 들고 있는다.
  // 렌더 시점의 값이라 리스너 안에서는 항상 갱신 전 상태다 — 그게 diff의 기준이다.
  const previousBoardRef = useRef(myBoard)
  previousBoardRef.current = myBoard
  const autoRecordedRoundRef = useRef<number | null>(null)

  useEffect(
    () =>
      realtimeClient.onMessage((message) => {
        const pending = pendingSubmissionRef.current
        if (!pending) {
          // 내가 보낸 제출이 없는데 내 점수가 갱신됐다 = 서버가 마감 처리로 대신 기록했다.
          // 점수판만 조용히 바뀌면 왜 그 칸이 채워졌는지 알 수 없어 라운드 파악이 어려워진다.
          if (
            message.type === 'score.update' &&
            message.payload.playerId === session.you &&
            autoRecordedRoundRef.current !== roundNumber
          ) {
            const recorded = newlyRecordedCategory(
              previousBoardRef.current,
              message.payload.scoreboard,
            )
            if (recorded) {
              autoRecordedRoundRef.current = roundNumber
              showToast(
                `시간이 지나 ${categoryLabel[recorded[0]]} ${recorded[1]}점으로 자동 기록됐어요.`,
              )
            }
          }
          return
        }

        if (
          message.type === 'score.update' &&
          message.msgId === pending.msgId &&
          message.payload.playerId === session.you
        ) {
          pendingSubmissionRef.current = null
          dispatch({ type: 'submissionSucceeded' })
          setSubmitting(false)
          setSheetOpen(false)
          return
        }

        if (message.type === 'error' && message.payload.refMsgId === pending.msgId) {
          pendingSubmissionRef.current = null
          dispatch({ type: 'submissionFailed' })
          setSubmitting(false)
          showToast(turnAwareErrorMessage(message.payload))
        }
      }),
    [dispatch, realtimeClient, roundNumber, session.you, showToast],
  )

  const rollSequenceRef = useRef(0)
  const inputModeRef = useRef(rollInputMode)
  const pendingRollRequestRef = useRef<{
    inputMode: RollInputMode
    msgId: string
    requestId: string
  } | null>(null)
  const queuedMotionReleaseRef = useRef(false)
  // 관전 중인 굴림. dice.thrown이 어느 requestId를 쏟아야 하는지 여기서 찾는다 —
  // 브로드캐스트 핸들러 안에서 바로 채우므로 리렌더를 기다리지 않는다.
  const remoteRollRef = useRef<{
    requestId: string
    rollCount: number
    roundNumber: number
  } | null>(null)
  // dice.thrown이 dice.broadcast보다 먼저 처리된 경우를 위한 예약(순서는 보장되지만
  // 굴림이 화면에 걸리기 전에 도착할 수 있다). 굴림이 생기는 즉시 쏟는다.
  const queuedRemoteReleaseRef = useRef<{ rollCount: number; roundNumber: number } | null>(null)
  const feedbackRef = useRef<ReturnType<typeof createRollFeedback> | null>(null)
  const handVoiceRef = useRef<HandVoice | null>(null)
  inputModeRef.current = rollInputMode
  if (!feedbackRef.current) feedbackRef.current = createRollFeedback({ muted: readSoundMuted() })

  /**
   * 바뀐 KEEP을 서버에 알린다. dice.roll이 실어 나르는 held는 "그 굴림에 쓴 값"이라,
   * 굴린 뒤에 바꾼 KEEP은 이 경로가 없으면 다음 굴림 전까지 상대 화면에 반영되지 않는다.
   * 실패해도 조용히 넘어간다 — 내 화면은 이미 맞고, 다음 토글이나 굴림이 상태를 복구한다.
   */
  const publishHeld = useCallback(
    (held: HeldDice) => {
      try {
        realtimeClient.send(buildClientMessage('dice.hold', { held, roundNumber }, { roomId }))
      } catch {
        // 연결이 끊긴 상태다. ConnectionBanner가 이미 알리고 있다.
      }
    },
    [realtimeClient, roomId, roundNumber],
  )

  /**
   * 내 흔들림 펄스를 방에 알린다. 관전 화면은 이걸 그대로 자기 사발에 먹여 같은 손놀림을 따라 한다 —
   * 없으면 남의 화면에서는 내가 손을 멈춰도 사발이 계속 흔들린다.
   * 펄스는 잦아서 SHAKE_RELAY_INTERVAL_MS 간격으로만 내보낸다.
   */
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
        // 연결이 끊긴 상태다. ConnectionBanner가 이미 알리고 있다.
      }
    },
    [realtimeClient, roomId, roundNumber],
  )

  /**
   * 내가 사발을 던졌다고 방에 알린다. dice.roll은 "흔들기 시작"에 나가 눈을 미리 받아두므로,
   * 이 신호가 없으면 관전자는 던진 시점을 몰라 내가 흔드는 동안 먼저 주사위를 쏟는다.
   * 실패해도 게임 진행은 어긋나지 않는다 — 눈은 dice.roll에서 이미 확정됐다. 다만 이 신호가
   * 유실된 관전 화면은 서버가 턴을 넘길 때까지 사발을 흔든다.
   */
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
        // 연결이 끊긴 상태다. ConnectionBanner가 이미 알리고 있다.
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

  useEffect(
    () =>
      realtimeClient.onMessage((message) => {
        if (message.type === 'dice.broadcast') {
          const currentGame = latestGameState(
            renderedGameRef.current,
            useAppStore.getState().roomSnapshot?.game,
          )
          if (!isCurrentDiceBroadcast(message, roomId, currentGame)) return

          const ownRoll = message.payload.playerId === session.you
          // 마감 시각이 지나 서버가 대신 굴린 결과. 내가 요청한 게 아니어도 반영해야 한다 —
          // 서버 상태는 이미 이 값이고, 버리면 다음 굴림·기록이 전부 어긋난다.
          const forced = message.payload.auto === true
          const pending = pendingRollRequestRef.current
          const matchingPending =
            ownRoll && !forced && pending && message.msgId === pending.msgId ? pending : null
          // 서버가 확정한 한 굴림은 모든 참가자에게 같은 키를 쓴다. 요청자의 로컬 msgId가
          // 유실됐더라도 권위 브로드캐스트를 버리면 요청자와 관전자의 최종 눈이 갈린다.
          const requestId = `roll-${message.payload.playerId}-${message.payload.roundNumber}-${message.payload.rollCount}`
          const animationMode = rollAnimationMode({
            forced,
            ownRoll,
            pendingInputMode: matchingPending?.inputMode ?? null,
          })

          // 남의 굴림은 그 사람이 던질 때까지 사발에 담아둔다 — 쏟는 시점은 dice.thrown이 정한다.
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
          // 굴림마다 새로 판단한다 — 지난 굴림을 흔들어 굴렸다고 이번 버튼 굴림까지
          // 펄스를 기다리면, 아무도 흔들지 않는 사발이 멈춰 선다.
          setRemoteShaking(false)
          acceptedRollTurnRef.current = {
            playerId: message.payload.playerId,
            roundNumber: message.payload.roundNumber,
          }
          setLocal((state) =>
            state.roundNumber === message.payload.roundNumber
              ? state
              : createYachtGame(state.seed, message.payload.roundNumber),
          )
          dispatch({
            type: 'rollRequested',
            forced,
            held: message.payload.held as HeldDice,
            requestId,
            // 굴림 횟수는 서버가 센 값을 그대로 받는다 — 클라가 따로 세면 어긋난다.
            rollCount: message.payload.rollCount,
            seed: animationSeedForRoll(
              roomId,
              message.payload.playerId,
              message.payload.roundNumber,
              message.payload.rollCount,
              message.payload.dice,
            ),
            targetDice: message.payload.dice,
          })
          if (ownRoll && forced) {
            showToast(`시간이 지나 서버가 ${message.payload.rollCount}번째 주사위를 굴렸어요.`)
          }
          if (ownRoll && queuedMotionReleaseRef.current) {
            queuedMotionReleaseRef.current = false
            setReleaseRequestId(requestId)
            publishThrow(message.payload.rollCount)
          }
          // 굴림이 걸리기 전에 도착해 둔 dice.thrown이 있으면 지금 쏟는다.
          const queuedRemote = queuedRemoteReleaseRef.current
          if (
            animationMode === 'remote' &&
            queuedRemote &&
            queuedRemote.roundNumber === message.payload.roundNumber &&
            queuedRemote.rollCount === message.payload.rollCount
          ) {
            queuedRemoteReleaseRef.current = null
            setReleaseRequestId(requestId)
          }
          return
        }

        if (message.type === 'dice.shaken') {
          if (
            message.roomId !== roomId ||
            message.payload.roundNumber !== roundNumber ||
            message.payload.playerId !== activePlayerId ||
            // 내 펄스의 메아리다. 내 사발은 기기 센서가 이미 흔들고 있다.
            message.payload.playerId === session.you ||
            // 굴림이 아직 화면에 안 걸렸다. 먹일 사발이 없으니 이 펄스는 버린다.
            !remoteRollRef.current
          ) {
            return
          }
          // 펄스가 오는 동안만 사발이 흔들린다 — 굴린 사람이 손을 멈추면 여기도 조용해지고,
          // 사발 세기가 감쇠하며 주사위가 같이 잦아든다. 소리도 그 움직임을 따라간다.
          feedbackRef.current?.remoteShakePulse()
          setRemoteShaking(true)
          motionPulseSequenceRef.current += 1
          setMotionPulse({
            id: motionPulseSequenceRef.current,
            direction: message.payload.direction,
            strength: message.payload.strength,
          })
          return
        }

        if (message.type === 'dice.thrown') {
          if (
            message.roomId !== roomId ||
            message.payload.roundNumber !== roundNumber ||
            message.payload.playerId !== activePlayerId ||
            // 내 던짐의 메아리다. 내 화면은 제스처가 이미 쏟았다.
            message.payload.playerId === session.you
          ) {
            return
          }
          const remote = remoteRollRef.current
          if (
            remote &&
            remote.roundNumber === message.payload.roundNumber &&
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
          return
        }

        if (message.type === 'dice.hold_changed') {
          // 내가 보낸 것의 메아리는 무시한다 — 내 화면이 이미 맞고, 연달아 탭하는 중이면
          // 뒤늦게 온 이전 상태가 방금 누른 KEEP을 되돌려 버린다.
          if (
            message.roomId !== roomId ||
            message.payload.roundNumber !== roundNumber ||
            message.payload.playerId !== activePlayerId ||
            message.payload.playerId === session.you
          ) {
            return
          }
          dispatch({ type: 'heldSynced', held: message.payload.held as HeldDice })
          return
        }

        const pending = pendingRollRequestRef.current
        if (message.type === 'error' && pending && message.payload.refMsgId === pending.msgId) {
          pendingRollRequestRef.current = null
          setRequestingRoll(false)
          setRollInputMode(null)
          showToast(turnAwareErrorMessage(message.payload))
        }
      }),
    [
      activePlayerId,
      dispatch,
      publishThrow,
      realtimeClient,
      roomId,
      roundNumber,
      session.you,
      showToast,
    ],
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
    if (!pendingRoll) return
    // 남의 굴림(remote)에는 타이머를 두지 않는다 — 관전 화면은 굴리는 사람 화면을 그대로
    // 따라가야 하고, 쏟는 시점은 오직 그 사람의 dice.thrown이 정한다.
    // dice.thrown이 유실되면 그 턴 동안 사발이 계속 흔들리지만, 서버가 마감(25초,
    // RoundTimerService.ROUND_DURATION)에 대신 굴리거나 다음 턴으로 넘기는 순간
    // activePlayerId 효과가 굴림을 새로 시작하며 걷어낸다.
    if (rollInputMode !== 'tap' && rollInputMode !== 'auto') return
    const timeout = setTimeout(() => {
      setReleaseRequestId(pendingRoll.requestId)
      // 버튼으로 굴린 것도 "던진 것"이다 — 관전 화면이 같은 순간에 쏟게 알린다.
      // 마감 자동 굴림(auto)은 던진 사람이 없고, 모두가 auto 표시를 받아 각자 쏟는다.
      if (rollInputMode === 'tap') publishThrow(local.rollCount)
    }, TAP_RELEASE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [local.rollCount, pendingRoll, publishThrow, rollInputMode])

  useEffect(
    () => () => {
      feedbackRef.current?.dispose()
    },
    [],
  )

  /*
   * 음성 재생기는 제스처 리스너를 걸고 오디오 요소를 들고 있으므로 수명을 effect가 소유한다.
   * 렌더 중에 만들고 cleanup에서 버리면 StrictMode의 mount → cleanup → mount에서
   * 버려진 객체만 남아 자동재생 잠금이 풀리지 않는다.
   */
  useEffect(() => {
    const voice = createHandVoice({ muted: readSoundMuted() })
    handVoiceRef.current = voice
    return () => {
      voice.dispose()
      handVoiceRef.current = null
    }
  }, [])

  /*
   * 족보 콜아웃이 화면에 뜨는 커밋에서 같이 외친다(S15P11A406-138). 텍스트와 목소리가
   * 같은 상태(rollHighlight) 하나에서 나오므로 어긋나지 않는다 — 이미 기록한 족보처럼
   * 연출을 건너뛴 굴림에는 목소리도 나오지 않는다.
   */
  useEffect(() => {
    if (rollHighlight) handVoiceRef.current?.play(rollHighlight.hand)
  }, [rollHighlight])

  const toggleSound = () => {
    const muted = !soundMuted
    setSoundMuted(muted)
    saveSoundMuted(muted)
    feedbackRef.current?.setMuted(muted)
    handVoiceRef.current?.setMuted(muted)
    setSoundtrackMuted(muted)
  }

  const handleRoll = () => {
    if (!canRoll) return
    beginRoll('tap')
  }

  const confirmThrow = () => {
    if (!pendingRoll || releaseRequestId === pendingRoll.requestId) return
    feedbackRef.current?.thrown()
    setReleaseRequestId(pendingRoll.requestId)
    publishThrow(local.rollCount)
  }

  const completeRoll = (requestId: string, _dice: DiceSet) => {
    const completedDice = pendingRoll?.requestId === requestId ? pendingRoll.targetDice : null
    if (!completedDice) return
    dispatch({ type: 'rollCompleted', requestId, dice: completedDice })
    setReleaseRequestId(null)
    setRollInputMode(null)
    if (isMyTurn) {
      motion.resetGesture('roll-complete')
    }
    // 서버 브로드캐스트를 재생한 모든 참가자에게 같은 족보 연출을 보여준다.
    // 이미 기록한 족보면 다시 쓸 수 없으므로 현재 턴 플레이어의 점수판을 기준으로 건너뛴다.
    const hand = detectSpecialHand(completedDice)
    if (hand && !isRecorded(activeBoard?.categories[hand])) {
      setRollHighlight({ hand, id: Date.now() })
    }
  }

  // 점수표 행·퀵 칩 공용 원큐 기록. 0점만 잃는 선택이라 확인 모달을 거친다.
  const pickCategory = (category: YachtCategory) => {
    if (!canPick) return
    if ((candidates[category] ?? 0) === 0) {
      setZeroConfirm(category)
      return
    }
    submitCategory(category)
  }

  // 마지막 굴림이 끝나면 족보 시트를 자동으로 연다(1d 인터랙션 명세).
  useEffect(() => {
    if (wide || submitted) return
    if (local.phase === 'choosing' && local.rollCount >= MAX_ROLLS) setSheetOpen(true)
  }, [local.phase, local.rollCount, submitted, wide])

  useMyTurnAlert({
    isMyTurn: isMyTurn && !submitted,
    onAlert: () => {
      // 하단 토스트는 시선 밖이라 놓치기 쉽다 — 족보 이펙트와 같은 대형 콜아웃으로 알린다.
      setTurnCallout(Date.now())
      vibrateForMyTurn()
    },
  })

  useRoundStartNotice({
    roundNumber,
    onNotice: () => {
      // 내 턴 시작은 useMyTurnAlert가 이미 알린다 — 여기선 관전 중일 때만 띄운다.
      if (isMyTurn || !activePlayer) return
      showToast(`라운드 ${roundNumber} 시작 — ${activePlayer.nickname}의 턴이에요`)
    },
  })

  useShortcuts(wide && isMyTurn, { onRoll: handleRoll, dispatch })

  // 상단 진행 표시 — 서버가 준 턴 순서 그대로다(명단 순서는 턴 순서가 아니다).
  const turnPlayers = toTurnStripPlayers(snapshot.players, game?.turnOrder, game?.scores)
  const turnStrip = (
    <TurnStrip activePlayerId={activePlayerId} players={turnPlayers} you={session.you} />
  )

  const trayLabel = activePlayer
    ? isMyTurn
      ? `롤링 존 · 나 · 굴림 ${currentRollNumber}/${MAX_ROLLS}`
      : `롤링 존 · ${activePlayer.nickname}의 턴`
    : '턴 동기화 중'

  const keptSum = local.dice
    ? local.dice.reduce((sum, value, index) => sum + (local.held[index] ? value : 0), 0)
    : 0

  const rolled = local.dice !== null

  // 코치마크와 자리를 나눠 쓴다 — 권한 안내가 떠 있는 동안에는 코치마크를 미룬다.
  const permissionNoticeVisible =
    isPermissionNoticeState(motion.availability) && dismissedNotice !== motion.availability

  /* 지금 뭘 하면 되는지 한 문장으로 알려준다. 트레이 하단 가운데에 한 줄로 눕히므로
     개행 없이 들어갈 길이를 유지한다 — 길어지면 킵 레일 라벨과 부딪힌다(S15P11A406-94). */
  const statusText = submitted
    ? '점수가 반영됐습니다 · 다음 턴 대기'
    : !isMyTurn
      ? `${activePlayer?.nickname ?? '—'}님이 굴리는 중입니다`
      : allKept
        ? '모두 킵했습니다 · 해제하거나 족보를 기록하세요'
        : rolled
          ? '홀드하고 다시 굴리거나, 족보를 탭해 기록하세요'
          : `라운드 ${roundNumber} — 굴려서 시작하세요`

  const diceScene = (
    <div
      className={cn(
        // 디자인 04 트레이 — 라운드 코너·헤어라인 보더·상단 하이라이트의 매트 블랙 그릇.
        'relative min-h-0 flex-1 overflow-hidden rounded-[1.375rem] border border-white/8 shadow-[inset_0_2px_0_rgb(255_255_255_/_6%),inset_0_-26px_46px_rgb(0_0_0_/_62%)] transition-transform [background:var(--ds-physics-tray)] motion-reduce:transform-none',
        wide ? 'mx-gutter my-3' : 'mx-gutter mt-3 mb-1',
        motion.lastPulseDirection === 'left' && '-translate-x-1',
        motion.lastPulseDirection === 'right' && 'translate-x-1',
      )}
    >
      <div className="pointer-events-none absolute top-3 left-4 z-10 text-[10px] font-bold tracking-[0.13em] text-content-faint uppercase">
        {trayLabel}
      </div>
      {/* 남은 굴리기는 트레이 우측 상단 — 시선이 머무는 곳이 트레이고, 푸터에 두면 영역을 차지한다. */}
      <div className="pointer-events-none absolute top-2.5 right-3 z-10 flex items-center gap-1.5">
        <RollCounter rollsUsed={settledRollCount} />
        {/* 트레이 탭은 굴리기·홀드 조작이라, 툴팁 트리거에만 pointer-events를 되살린다. */}
        <Tooltip
          align="end"
          className="pointer-events-auto text-content-faint"
          content="턴마다 최대 3번 굴릴 수 있어요. 주사위 눈이 남은 횟수예요."
          label="남은 굴리기 설명"
        />
      </div>
      {/* 하단 밴드 — 킵 레일 라벨(좌)과 안내문(가운데)을 같은 grid에 둔다. 안내문을 따로
          absolute로 가운데 두면 좁은 폭에서 좌측 라벨과 겹친다. 1fr auto 1fr이므로
          가운데 칼럼은 트레이 정중앙에 놓이고, 라벨은 자기 칼럼 안에서만 접힌다. */}
      <div className="pointer-events-none absolute inset-x-4 bottom-2.5 z-10 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.13em] text-content-faint uppercase">
          킵 레일 ·{' '}
          {keptCount > 0
            ? `${keptCount}/5 · 합 ${keptSum}${allKept ? ' · 해제해야 굴릴 수 있어요' : ''}`
            : '비어 있음'}
          <Tooltip
            align="start"
            className="pointer-events-auto"
            content="주사위를 탭하면 킵돼서 여기 줄지어요. 킵한 주사위는 다시 굴리지 않고, 한 번 더 탭하면 풀려요."
            label="킵 레일 설명"
            side="top"
          />
        </span>
        {/* 안내문은 와이드에서만 — 모바일은 기록 패널이 안내를 겸한다. */}
        {wide ? (
          <p className="m-0 text-center text-sm/none whitespace-nowrap text-content-muted">
            {statusText}
          </p>
        ) : (
          <span />
        )}
        <span />
      </div>
      <PhysicsDiceScene
        dice={local.dice}
        held={local.held}
        lineUpAll={lastRollInPlay}
        motionFollow={rollInputMode === 'motion' || remoteShaking}
        motionPulse={motionPulse}
        releaseRequestId={releaseRequestId}
        onDiceImpact={(index, strength) => feedbackRef.current?.diceImpact(index, strength)}
        onError={() => feedbackRef.current?.error()}
        onHeldToggle={(index) => {
          if (!canHold) return
          dispatch({ type: 'holdToggled', index })
          publishHeld(toggleHeldDie(local.held, index))
        }}
        onPhaseChange={(phase) => feedbackRef.current?.phaseChanged(phase)}
        onRollComplete={completeRoll}
        request={pendingRoll}
      />
      {/* 첫 굴림 전에는 트레이 전체가 탭 타깃이다. 주사위가 깔린 뒤에는
          탭이 "홀드 토글"을 뜻하므로 이 오버레이를 걷어 충돌을 없앤다. */}
      {canRoll && local.dice === null && !pendingRoll && (
        <button
          aria-label="주사위 굴리기"
          className="absolute inset-0 z-10 grid cursor-pointer place-items-center border-0 bg-transparent focus-visible:outline-3 focus-visible:outline-focus focus-visible:-outline-offset-4"
          onClick={handleRoll}
          type="button"
        >
          <span className="text-[11px] font-bold tracking-[0.1em] text-content-faint uppercase">
            탭해서 굴리기
          </span>
        </button>
      )}
      {rollHighlight && (
        <RollResultCallout
          hand={rollHighlight.hand}
          key={rollHighlight.id}
          onDone={() => setRollHighlight(null)}
        />
      )}
      {turnCallout !== null && (
        <EffectCallout
          key={turnCallout}
          onDone={() => setTurnCallout(null)}
          text="내 차례!"
          tier={2}
        />
      )}
      {pendingRoll && rollInputMode === 'motion' && (
        <Button
          className="absolute top-14 right-3 z-20 shadow-raised"
          disabled={releaseRequestId !== null}
          onClick={confirmThrow}
        >
          지금 던지기
        </Button>
      )}
      {isPermissionNoticeState(motion.availability) && dismissedNotice !== motion.availability && (
        <div className="absolute inset-x-3 top-3 z-30">
          <MotionPermissionPanel
            availability={motion.availability}
            onClose={() => setDismissedNotice(motion.availability)}
            onRequestPermission={motion.requestPermission}
          />
        </div>
      )}
      {/* 첫 판 마스코트 가이드 — 실제 굴림·킵·기록에 반응해 다음 안내로 넘어간다.
          권한 안내 패널이 떠 있는 동안에는 겹치지 않게 미룬다. */}
      {tutorialOpen && !permissionNoticeVisible && (
        <TutorialGuide
          isMyTurn={isMyTurn && !submitted}
          kept={keptCount > 0}
          onFinish={() => {
            // 끝까지 봤으면 다음 게임에서 또 처음부터 반복하지 않는다.
            hideTutorial()
            setTutorialOpen(false)
          }}
          onNeverShowAgain={() => {
            hideTutorial()
            setTutorialOpen(false)
          }}
          onSkip={() => setTutorialOpen(false)}
          rolled={rolled}
          submitted={submitted}
        />
      )}
    </div>
  )

  // 디자인 04 헤더의 ✕ — 나가기는 아이콘 버튼 하나로 줄인다(확인 모달이 뒤에 있다).
  const leaveButton = (
    <button
      aria-label="나가기"
      className="grid size-10 flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-[15px] text-content-muted transition-colors hover:text-content focus-visible:outline-3 focus-visible:outline-focus"
      onClick={onLeaveRequest}
      type="button"
    >
      ✕
    </button>
  )

  // 규칙·족보는 언제든 다시 볼 수 있어야 한다 — 나가기와 같은 급의 아이콘 버튼 하나.
  const helpButton = (
    <button
      aria-label="게임 도움말"
      className="grid size-10 flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-[15px] font-bold text-content-muted transition-colors hover:text-content focus-visible:outline-3 focus-visible:outline-focus"
      onClick={() => setHelpOpen(true)}
      type="button"
    >
      ?
    </button>
  )

  /* 족보 목소리는 갑자기 크게 튀어나오는 연출이다 — 조용한 곳에서 끌 방법이 화면 안에 있어야 한다.
     ✕과 같은 아이콘 버튼 규격으로 맞춰 헤더 폭을 더 쓰지 않는다. */
  const soundButton = (
    <button
      aria-label={soundMuted ? '소리 켜기' : '소리 끄기'}
      aria-pressed={!soundMuted}
      className="grid size-10 flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-[15px] text-content-muted transition-colors hover:text-content focus-visible:outline-3 focus-visible:outline-focus"
      onClick={toggleSound}
      type="button"
    >
      <span aria-hidden="true">{soundMuted ? '🔇' : '🔊'}</span>
    </button>
  )

  // ROUND 라벨 아래 "누구 턴인지"를 점·색으로 병기한다(디자인 04·05).
  const turnStatus = (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[11px] leading-none font-bold tracking-[0.16em] text-content-muted uppercase">
        Round {String(roundNumber).padStart(2, '0')} / {TOTAL_ROUNDS}
      </span>
      <span
        className={cn(
          'flex items-center gap-1.5 truncate text-[16px] font-bold transition-colors duration-base',
          // 턴 주인이 바뀌면 라벨을 리마운트해 짧은 flash로 전환을 알린다(QA FND-7).
          'motion-safe:animate-turn-flash',
          !isMyTurn && activePlayer && 'text-[#FF8A86]',
        )}
        key={activePlayerId ?? 'sync'}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 flex-none rounded-full transition-colors duration-base',
            isMyTurn && !submitted
              ? 'bg-positive'
              : activePlayer
                ? 'bg-brand-strong shadow-[0_0_8px_rgb(229_57_53_/_90%)] motion-safe:animate-ring-pulse'
                : 'bg-content-faint',
          )}
        />
        {/* 내 제출이 끝났는데 activePlayerId가 아직 나인 구간엔 내 이름을 그대로 반복하는 대신
            "대기 중"임을 분명히 한다 — 서버의 다음 round.start를 기다리는 상태다(QA FND-3). */}
        {isMyTurn && !submitted
          ? '내 턴이에요'
          : isMyTurn && submitted
            ? '제출 완료 · 대기 중'
            : activePlayer
              ? `${activePlayer.nickname}의 턴`
              : '턴 동기화 중'}
      </span>
    </span>
  )

  const timerRing = (
    <RoundTimer
      compact
      remainingMs={remainingMs}
      roundNumber={roundNumber}
      totalRounds={TOTAL_ROUNDS}
    />
  )

  const header = (
    <header
      className={cn(
        'flex flex-none items-center px-gutter',
        wide ? 'h-[4.5rem] gap-5 border-b border-border' : 'h-[4.25rem] gap-3',
      )}
    >
      <h1 className="sr-only">
        요르 게임 진행 중 · {roundNumber} / {TOTAL_ROUNDS} 라운드
      </h1>
      {wide ? (
        // 디자인 23 데스크톱 헤더 — ✕ · 라운드/턴 · 선두 · 연결 상태 · 링 타이머.
        <>
          {leaveButton}
          {turnStatus}
          <span aria-hidden="true" className="h-8 w-px flex-none bg-border" />
          <HeaderStat label="선두" value={leaderLabel} />
          <span className="flex-1" />
          <span className="inline-flex h-[2.125rem] flex-none items-center gap-2 rounded-full border border-border bg-white/6 px-3.5 text-[13px] font-semibold">
            <span
              aria-hidden="true"
              className={cn(
                'size-[7px] rounded-full',
                connectionStatus === 'connected' ? 'bg-positive' : 'bg-warning',
              )}
            />
            {connectionStatus === 'connected'
              ? '연결됨'
              : connectionStatus === 'reconnecting'
                ? '재연결 중'
                : connectionStatus === 'closed'
                  ? '연결 끊김'
                  : '연결 중'}
          </span>
          {helpButton}
          {soundButton}
          {timerRing}
        </>
      ) : (
        <>
          {leaveButton}
          <div className="min-w-0 flex-1">{turnStatus}</div>
          {helpButton}
          {soundButton}
          {timerRing}
        </>
      )}
    </header>
  )

  // 내 차례가 아니면 CTA 자리를 비워둔다. "누가 진행 중인지"는 상단 스트립이 항상 보여주므로
  // 여기서 같은 정보를 반복하지 않는다(중복 표시가 오히려 시선을 아래로 끌었다).
  const waitingNotice = submitted ? (
    // 디자인 21 — 기록 완료는 그린 틴트로 "끝났다"를 말한다.
    <p className="m-0 flex min-h-15 flex-1 items-center justify-center gap-2.5 rounded-panel border border-positive/40 bg-positive/10 px-4 text-center text-sm font-semibold text-positive">
      <span
        aria-hidden="true"
        className="grid size-5 flex-none place-items-center rounded-[7px] bg-positive/20 text-[11px] leading-none font-bold"
      >
        ✓
      </span>
      점수가 반영됐습니다. 다음 턴을 기다립니다.
    </p>
  ) : (
    // 디자인 21 하단 바 — 남의 턴에는 누가 굴리는지 펄스 도트와 함께 보여준다.
    <p className="m-0 flex min-h-15 flex-1 items-center justify-center gap-2.5 rounded-panel border border-border bg-surface px-4 text-center text-sm font-semibold text-content-muted">
      <span
        aria-hidden="true"
        className="size-2 flex-none rounded-[2px] bg-brand-strong motion-safe:animate-ring-pulse"
      />
      {/* 닉네임은 임의 입력이라 받침 유무를 알 수 없다 — "(으)로"와 같은 방식으로 이/가를 표기한다(QA FND-9). */}
      {activePlayer ? `${activePlayer.nickname}(이)가 굴리는 중` : '턴 동기화 중'}
    </p>
  )

  const zeroModal = (
    <ZeroScoreModal
      category={zeroConfirm}
      onCancel={() => setZeroConfirm(null)}
      onConfirm={() => {
        const category = zeroConfirm
        setZeroConfirm(null)
        if (category) submitCategory(category)
      }}
    />
  )

  // 디자인의 quick chips — 열린 족보를 고정 순서로 눕히고 탭 한 번에 기록한다.
  const openCategories = YACHT_CATEGORIES.filter(
    (category) => !isRecorded(activeBoard?.categories[category]),
  )

  // 디자인 기록 패널의 퀵 칩 — peek 상태에서도 보이는 원큐 기록 스트립.
  const quickStrip = (
    <ul className="m-0 flex list-none gap-2 overflow-x-auto px-4 py-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {openCategories.map((category) => {
        const score = rolled ? (candidates[category] ?? 0) : null
        return (
          <li className="flex-none" key={category}>
            <button
              aria-label={`${categoryLabel[category]}${score === null ? '' : ` ${score}점 기록`}`}
              className="flex h-[4.125rem] min-w-[5.5rem] cursor-pointer flex-col items-start justify-between rounded-control border border-border bg-surface px-2.5 py-2 text-left text-content transition-colors focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!canPick || !rolled}
              onClick={() => pickCategory(category)}
              type="button"
            >
              <span className="text-[10px] font-semibold tracking-[0.07em] uppercase">
                {categoryShortLabel[category]}
              </span>
              <span className="font-mono text-[22px] leading-none font-bold tabular-nums">
                {score ?? '—'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  // 킵 레일을 통째로 비우는 보조 동작(디자인 Yacht Play 3D의 Release all).
  const canReleaseAll = keptCount > 0 && canHold
  const releaseAll = () => {
    local.held.forEach((isHeld, index) => {
      if (isHeld) dispatch({ type: 'holdToggled', index: index as DiceIndex })
    })
    // 토글마다 보내면 최대 5번이 나간다 — 결과 한 번만 알린다.
    publishHeld(NO_HELD_DICE)
  }

  // 기록은 점수표·칩 탭으로 끝나므로 CTA는 굴리기 하나다(디자인 하단 바).
  const actions =
    submitted || !isMyTurn ? (
      waitingNotice
    ) : (
      <>
        <Button
          className={cn('min-h-15 rounded-panel text-[17px]', wide ? 'w-[300px]' : 'flex-1')}
          disabled={!canRoll}
          loading={rolling || submitting}
          onClick={handleRoll}
          size="lg"
        >
          {rolling ? '굴리는 중' : '굴리기'}
          {wide && !rolling && <span className="ml-2 text-xs font-medium opacity-70">Space</span>}
        </Button>
        {wide && (
          <Button
            className="min-h-15"
            disabled={!canReleaseAll}
            onClick={releaseAll}
            variant="ghost"
          >
            모두 해제
          </Button>
        )}
      </>
    )

  const scoreSheet = (className?: string) => (
    <ScoreSheet
      activePlayerId={activePlayerId}
      candidates={candidates}
      canPick={canPick}
      {...(className ? { className } : {})}
      onPick={pickCategory}
      players={sheetPlayers}
      you={session.you}
    />
  )

  const sheetHint = !isMyTurn
    ? `${activePlayer?.nickname ?? '—'} 차례`
    : rolled
      ? '행을 탭하면 바로 기록됩니다'
      : '먼저 주사위를 굴리세요'

  return (
    <>
      {/*
        레이아웃이 바뀌어도 트리 한 벌만 쓴다. 넓이별로 다른 트리를 반환하면
        React가 위치가 같고 타입이 다른 노드를 갈아끼우면서 주사위 영역을 언마운트하고,
        그때마다 rapier 물리 월드와 WebGL 컨텍스트가 통째로 재생성된다.
      */}
      {/* 뷰포트 높이로 고정하고 페이지 스크롤을 막는다 — 스크롤은 점수시트 내부에서만 일어난다. */}
      <main
        className={cn(
          'h-svh overflow-hidden bg-canvas text-content',
          wide ? 'grid grid-cols-[1fr_32.5rem]' : 'flex flex-col',
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 배너는 오버레이로 띄운다 — 플로우에 끼우면 나타날 때마다 3D 트레이 크기를 밀어
              씬이 리사이즈된다. 연결 상태는 일시적이라 헤더를 잠깐 덮는 쪽이 낫다. */}
          <ConnectionBanner
            className="absolute inset-x-0 top-0 z-banner"
            status={connectionStatus}
          />
          {header}
          {turnStrip}

          {/* 모바일 기록 패널이 이 컨테이너 아래에 붙는다 — 주사위 씬은 항상 같은 자리다. */}
          <div className={cn('flex min-h-0 flex-1 flex-col', !wide && 'relative')}>
            {diceScene}
            <footer
              className={cn(
                'flex flex-none items-center px-gutter',
                wide
                  ? // 안내문은 트레이 하단 가운데에 있다 — 푸터에는 버튼만 가운데에 남는다.
                    'justify-center gap-4 border-t border-border py-4'
                  : 'gap-2.5 pt-2 pb-[calc(8.75rem+env(safe-area-inset-bottom))]',
              )}
            >
              {actions}
            </footer>

            {wide ? null : (
              <RecordPanel
                onToggle={setSheetOpen}
                open={sheetOpen}
                quick={quickStrip}
                subtitle={`${openCategories.length}개 남음`}
                title={`기록 — ${isMyTurn ? '나' : (activePlayer?.nickname ?? '—')}`}
              >
                {scoreSheet('h-full')}
              </RecordPanel>
            )}
          </div>
        </div>

        {/* 디자인 Yacht Play 3D — 점수시트는 우측 상시 패널(520px)이다. */}
        {wide ? (
          <section aria-label="점수 시트" className="flex min-h-0 flex-col border-l border-border">
            <div className="flex flex-none items-center justify-between gap-2 px-4 py-3">
              <span className="text-[11px] font-bold tracking-[0.1em] uppercase">점수 시트</span>
              <span className="truncate text-[11px] text-content-faint">{sheetHint}</span>
            </div>
            {scoreSheet('min-h-0 flex-1')}
          </section>
        ) : null}
      </main>

      <ToastHost message={toastMessage} />
      {zeroModal}
      <GameHelpModal onClose={() => setHelpOpen(false)} open={helpOpen} />
    </>
  )
}

function HeaderStat({
  accent = false,
  label,
  value,
}: {
  accent?: boolean
  label: string
  value: string
}) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] font-medium tracking-[0.08em] text-content-faint uppercase">
        {label}
      </span>
      <span className={cn('text-[17px] font-bold', accent ? 'text-brand-strong' : 'text-content')}>
        {value}
      </span>
    </div>
  )
}

function ZeroScoreModal({
  category,
  onCancel,
  onConfirm,
}: {
  category: YachtCategory | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      onClose={onCancel}
      open={category !== null}
      title={category ? `${categoryLabel[category]}를 0점으로 확정할까요?` : ''}
    >
      <p className="m-0 text-sm text-content-muted">이 족보는 다시 사용할 수 없습니다.</p>
      {/* 디자인 19 — 안전한 선택(취소)이 위, 확정은 다크 레드(잃는 선택임을 색으로도 말한다). */}
      <div className="mt-5 grid gap-2.5">
        <Button onClick={onCancel} variant="secondary">
          취소
        </Button>
        <Button
          className="bg-[#8F1D1D] text-[#FFE9E8] shadow-none hover:bg-[#A32421]"
          onClick={onConfirm}
        >
          0점 확정
        </Button>
      </div>
    </Modal>
  )
}

/** 웹 전용 단축키. 리스너를 매 렌더 다시 붙이지 않도록 최신 핸들러만 ref로 넘긴다. */
function useShortcuts(
  enabled: boolean,
  handlers: {
    dispatch: (action: YachtGameAction) => void
    onRoll: () => void
  },
) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      // 버튼·입력처럼 Space·Enter가 고유 동작인 요소에 포커스가 있으면 단축키를 양보한다.
      // 여기서 preventDefault하면 그 요소의 활성화 자체가 막힌다.
      if (
        event.target instanceof Element &&
        event.target.closest(
          'a[href],button,input,select,textarea,[contenteditable],[role="button"]',
        )
      ) {
        return
      }
      if (event.code === 'Space') {
        event.preventDefault()
        handlersRef.current.onRoll()
        return
      }
      const slot = Number(event.key)
      if (Number.isInteger(slot) && slot >= 1 && slot <= 5) {
        handlersRef.current.dispatch({ type: 'holdToggled', index: (slot - 1) as DiceIndex })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/**
 * 마감 처리는 서버가 한다 — 남은 굴림이 있으면 대신 굴리고, 다 쓰면 남은 족보 중 하나를 기록한 뒤
 * 턴을 넘긴다(RoundTimeoutResolver). 클라이언트가 같은 일을 하면 두 경로가 경합하면서 어느 쪽도
 * 기록되지 않는 창이 생기므로 여기서는 아무것도 하지 않는다.
 */
/**
 * 내 차례가 시작되는 순간 한 번 알린다(QA 7번). 턴이 넘어가면 다시 무장된다.
 * 렌더마다 발화하지 않도록 직전 값과 비교한다 — 상태가 아니라 "전이"가 트리거다.
 */
function useMyTurnAlert({ isMyTurn, onAlert }: { isMyTurn: boolean; onAlert: () => void }) {
  const wasMyTurnRef = useRef(false)
  const onAlertRef = useRef(onAlert)
  onAlertRef.current = onAlert

  useEffect(() => {
    if (isMyTurn && !wasMyTurnRef.current) onAlertRef.current()
    wasMyTurnRef.current = isMyTurn
  }, [isMyTurn])
}

/**
 * 라운드가 바뀌는 순간 한 번 알린다(QA FND-7). 관전자에게도 전환 신호를 주되,
 * 턴마다 띄우면 피로하므로 라운드 시작으로 한정한다.
 */
function useRoundStartNotice({
  onNotice,
  roundNumber,
}: {
  onNotice: () => void
  roundNumber: number
}) {
  const previousRoundRef = useRef<number | null>(null)
  const onNoticeRef = useRef(onNotice)
  onNoticeRef.current = onNotice

  useEffect(() => {
    const previous = previousRoundRef.current
    previousRoundRef.current = roundNumber
    // 첫 렌더(중간 입장·재접속 포함)는 "전환"이 아니다 — 라운드가 실제로 바뀔 때만 알린다.
    if (previous === null || previous === roundNumber) return
    onNoticeRef.current()
  }, [roundNumber])
}

/** 짧은 두 번 진동. 미지원(iOS Safari 등)이면 조용히 넘어간다 — 토스트가 이미 알린다. */
function vibrateForMyTurn() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate([90, 60, 90])
  } catch {
    // 사용자 제스처 없이 호출하면 던지는 브라우저가 있다. 알림 실패가 게임을 막아선 안 된다.
  }
}

function isPermissionNoticeState(
  availability: ReturnType<typeof useMotionRollInput>['availability'],
): availability is 'permissionRequired' | 'requesting' | 'denied' | 'error' | 'insecure' {
  return (
    availability === 'permissionRequired' ||
    availability === 'requesting' ||
    availability === 'denied' ||
    availability === 'error' ||
    availability === 'insecure'
  )
}
