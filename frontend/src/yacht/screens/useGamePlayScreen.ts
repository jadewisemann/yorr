import { useChat } from '@/realtime/chat/ChatContext'
import type { GameState, PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { useToast } from '@/shared/components/ToastHost'
import { useWideLayout } from '@/shared/useWideLayout'
import { type ActiveRoomSession, useAppStore } from '@/store'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { canOfferMotion } from '@/yacht/input/motionTypes'
import { buildGamePlayView, type TurnProgress } from '@/yacht/model/gamePlayView'
import { useCountdown } from '@/yacht/model/useCountdown'
import {
  useGamePlayChrome,
  useMyTurnAlert,
  useRoundStartNotice,
  useShortcuts,
  vibrateForMyTurn,
} from '@/yacht/model/useGamePlayChrome'
import { type GamePlayRoll, useGamePlayRoll } from '@/yacht/model/useGamePlayRoll'
import { useGamePlaySubmission } from '@/yacht/model/useGamePlaySubmission'

interface GamePlayScreenInput {
  forceController: boolean
  leverageCategory: YachtCategory | null
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export type GamePlayScreen = ReturnType<typeof useGamePlayScreen>

/** 이번 라운드에서 누가 굴리고 언제 끝나는지 — 게임이 아직 없으면 1라운드·마감 없음으로 본다. */
function turnOf(game: GameState | undefined, you: PlayerId) {
  const activePlayerId = game?.activePlayerId
  return {
    activePlayerId,
    isMyTurn: activePlayerId === you,
    roundDeadline: game?.roundDeadline ?? null,
    roundNumber: game?.roundNumber ?? 1,
  }
}

/**
 * 게임 화면 한 장이 쓰는 상태를 모은다. 게임판·폰 컨트롤러·대시보드 세 형태가 같은 상태에서
 * 갈라지는 것이 이 화면의 사양이라, 상태는 여기 한 곳에서 만들고 구획은 받아서 그리기만 한다.
 */
export function useGamePlayScreen({
  forceController,
  leverageCategory,
  roomId,
  session,
  snapshot,
}: GamePlayScreenInput) {
  const wide = useWideLayout()
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const toast = useToast()
  const chat = useChat()
  const { game } = snapshot
  const turn = turnOf(game, session.you)
  const remainingMs = useRemainingMs(turn.roundDeadline)
  const canPlay = session.membershipRole !== 'dashboard'
  const roll = useGamePlayRoll({
    canPlay,
    game,
    roomId,
    showToast: toast.showToast,
    you: session.you,
  })
  const view = buildGamePlayView({
    dice: roll.local.dice,
    game,
    leverageCategory,
    players: snapshot.players,
    you: session.you,
  })
  const chrome = useGamePlayChrome({
    activePlayerId: turn.activePlayerId,
    phase: roll.local.phase,
    rollCount: roll.local.rollCount,
    setRollMuted: roll.feedback.setMuted,
    submitted: roll.submitted,
    wide,
  })
  const { pickCategory, submitCategory } = useCategorySubmission({
    chrome,
    roll,
    roomId,
    showToast: toast.showToast,
    turn,
    view,
    you: session.you,
  })
  useTurnNotices({
    activePlayer: view.activePlayer,
    chrome,
    roll,
    showToast: toast.showToast,
    turn,
    wide,
  })

  return {
    chat,
    chrome,
    connectionStatus,
    controller: forceController || (!wide && canPlay && isPartyRoom(session.roomCode)),
    leverageCategory,
    pickCategory,
    remainingMs,
    roll,
    submitCategory,
    toast,
    turn,
    view,
    wide,
    you: session.you,
  }
}

/**
 * 시계가 없는 판(봇만 있는 연습 방)은 서버가 마감을 null로 내려보낸다 —
 * 그때는 남은 시간이 0이 아니라 **없는 것**이라 헤더가 타이머를 아예 그리지 않는다.
 */
function useRemainingMs(roundDeadline: number | null) {
  const countdownMs = useCountdown(roundDeadline)
  return roundDeadline === null ? null : countdownMs
}

interface CategorySubmissionInput {
  chrome: ReturnType<typeof useGamePlayChrome>
  roll: GamePlayRoll
  roomId: string
  showToast: (message: string) => void
  turn: ReturnType<typeof turnOf>
  view: ReturnType<typeof buildGamePlayView>
  you: PlayerId
}

/** 점수 칸 제출. 0점 칸을 고르면 바로 내지 않고 `ZeroScoreModal`로 한 번 묻는다. */
function useCategorySubmission({
  chrome,
  roll,
  roomId,
  showToast,
  turn,
  view,
  you,
}: CategorySubmissionInput) {
  const { submitCategory } = useGamePlaySubmission({
    activePlayerId: turn.activePlayerId,
    dice: roll.local.dice,
    dispatch: roll.dispatch,
    myBoard: view.myBoard,
    onSucceeded: chrome.closeSheet,
    roomId,
    roundNumber: turn.roundNumber,
    showToast,
    you,
  })
  const pickCategory = (category: YachtCategory) => {
    if (!roll.canPick) return
    if ((view.candidates[category] ?? 0) === 0) {
      chrome.setZeroConfirm(category)
      return
    }
    submitCategory(category)
  }
  return { pickCategory, submitCategory }
}

interface TurnNoticesInput {
  activePlayer: ReturnType<typeof buildGamePlayView>['activePlayer']
  chrome: ReturnType<typeof useGamePlayChrome>
  roll: GamePlayRoll
  showToast: (message: string) => void
  turn: ReturnType<typeof turnOf>
  wide: boolean
}

/** 내 차례 알림, 라운드 시작 토스트, 넓은 화면의 단축키 — 턴이 바뀔 때 화면이 스스로 하는 일. */
function useTurnNotices({ activePlayer, chrome, roll, showToast, turn, wide }: TurnNoticesInput) {
  const { isMyTurn, roundNumber } = turn
  useMyTurnAlert({
    isMyTurn: isMyTurn && !roll.submitted,
    onAlert: () => {
      chrome.setTurnCallout(Date.now())
      vibrateForMyTurn()
    },
  })

  useRoundStartNotice({
    roundNumber,
    onNotice: () => {
      if (isMyTurn || !activePlayer) return
      showToast(`라운드 ${roundNumber} 시작 — ${activePlayer.nickname}의 턴이에요`)
    },
  })

  useShortcuts(wide && isMyTurn, { onRoll: roll.roll, dispatch: roll.dispatch })
}

/** 튜토리얼 안내가 다음 문장을 고르는 데 쓰는 지금 턴의 진행 상황. */
export function turnProgressOf({ roll, view, wide }: GamePlayScreen): TurnProgress {
  const { local } = roll
  return {
    rolled: view.rolled,
    keptValues: local.dice ? local.dice.filter((_value, index) => local.held[index]) : [],
    rolling: roll.rolling,
    submitted: roll.submitted,
    rollCount: local.rollCount,
    candidates: view.candidates,
    motionNoticeVisible: canOfferMotion(roll.motion.availability),
    wide,
  }
}
