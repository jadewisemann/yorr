import type { ReactNode } from 'react'
import { useChat } from '@/realtime/chat/ChatContext'
import { ChatDialog } from '@/realtime/chat/ChatDialog'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import { isPartyRoom } from '@/room/partyControllerStorage'
import { AudioPopover } from '@/shared/components/AudioPopover'
import { ToastHost, useToast } from '@/shared/components/ToastHost'
import { useWideLayout } from '@/shared/useWideLayout'
import { type ActiveRoomSession, useAppStore } from '@/store'
import { GameHelpModal } from '@/yacht/components/GameHelpModal'
import { GamePlayActions } from '@/yacht/components/GamePlay/GamePlayActions'
import { GamePlayBoard } from '@/yacht/components/GamePlay/GamePlayBoard'
import { QuickCategoryStrip } from '@/yacht/components/GamePlay/QuickCategoryStrip'
import { ZeroScoreModal } from '@/yacht/components/GamePlay/ZeroScoreModal'
import { ScoreSheet } from '@/yacht/components/ScoreSheet'
import { TurnStrip } from '@/yacht/components/TurnStrip'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import { canOfferMotion } from '@/yacht/input/motionTypes'
import { scoreRecordTitle, scoreSheetHint } from '@/yacht/model/gamePlayLabels'
import { buildGamePlayView } from '@/yacht/model/gamePlayView'
import { useCountdown } from '@/yacht/model/useCountdown'
import {
  useGamePlayChrome,
  useMyTurnAlert,
  useRoundStartNotice,
  useShortcuts,
  vibrateForMyTurn,
} from '@/yacht/model/useGamePlayChrome'
import { useGamePlayRoll } from '@/yacht/model/useGamePlayRoll'
import { useGamePlaySubmission } from '@/yacht/model/useGamePlaySubmission'
import { GameControllerPad } from './GameController'
import { GameDiceTray } from './GameDiceTray'
import { GamePlayHeader } from './GamePlayHeader'

interface GamePlayProps {
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
  onLeaveRequest: () => void
  guide?: (progress: TurnProgress) => ReactNode
  leverageCategory?: YachtCategory | null
  forceController?: boolean
}

export interface TurnProgress {
  rolled: boolean
  keptValues: number[]
  rolling: boolean
  submitted: boolean
  rollCount: number
  candidates: CategoryScores
  motionNoticeVisible: boolean
  wide: boolean
}

/*
 * 200줄 기준선 초과(원칙 7)를 알고 유지한다 — 훅은 이미 model/로 전부 나가 있고
 * (파일에 생 useState/useEffect가 0개다) 남은 것은 조립뿐이다. 게임판·폰 컨트롤러·
 * 대시보드 세 형태가 같은 상태에서 갈라지는 분기가 이 화면의 사양이라, 쪼개면
 * "어떤 조건에서 무엇이 보이나"를 세 파일을 오가며 읽게 된다.
 */
export function GamePlay({
  forceController = false,
  guide,
  leverageCategory = null,
  onLeaveRequest,
  roomId,
  session,
  snapshot,
}: GamePlayProps) {
  const wide = useWideLayout()
  const connectionStatus = useAppStore((state) => state.connectionStatus)
  const { message: toastMessage, showToast } = useToast()
  const chat = useChat()

  const game = snapshot.game
  const roundNumber = game?.roundNumber ?? 1
  const activePlayerId = game?.activePlayerId
  const isMyTurn = activePlayerId === session.you
  const roundDeadline = game?.roundDeadline ?? null
  const countdownMs = useCountdown(roundDeadline)
  /**
   * 시계가 없는 판(봇만 있는 연습 방)은 서버가 마감을 null로 내려보낸다 —
   * 그때는 남은 시간이 0이 아니라 **없는 것**이라 헤더가 타이머를 아예 그리지 않는다.
   */
  const remainingMs = roundDeadline === null ? null : countdownMs

  const canPlay = session.membershipRole !== 'dashboard'

  const controller = forceController || (!wide && canPlay && isPartyRoom(session.roomCode))

  const roll = useGamePlayRoll({
    canPlay,
    game,
    roomId,
    showToast,
    you: session.you,
  })
  const {
    canHold,
    canPick,
    canRoll,
    dispatch,
    keptCount,
    local,
    releaseAll,
    roll: handleRoll,
    rolling,
    submitted,
    submitting,
  } = roll

  const {
    activePlayer,
    candidates,
    leaderLabel,
    myBoard,
    openCategories,
    rolled,
    sheetPlayers,
    turnPlayers,
  } = buildGamePlayView({
    dice: local.dice,
    game,
    leverageCategory,
    players: snapshot.players,
    you: session.you,
  })

  const {
    audioButtonRef,
    audioOpen,
    chatButtonRef,
    chatOpen,
    closeSheet,
    helpOpen,
    setAudioOpen,
    setChatOpen,
    setHelpOpen,
    setSheetOpen,
    setTurnCallout,
    setZeroConfirm,
    sheetOpen,
    soundMuted,
    toggleSound,
    turnCallout,
    zeroConfirm,
  } = useGamePlayChrome({
    activePlayerId,
    phase: local.phase,
    rollCount: local.rollCount,
    setRollMuted: roll.feedback.setMuted,
    submitted,
    wide,
  })
  const { submitCategory } = useGamePlaySubmission({
    activePlayerId,
    dice: local.dice,
    dispatch,
    myBoard,
    onSucceeded: closeSheet,
    roomId,
    roundNumber,
    showToast,
    you: session.you,
  })

  const pickCategory = (category: YachtCategory) => {
    if (!canPick) return
    if ((candidates[category] ?? 0) === 0) {
      setZeroConfirm(category)
      return
    }
    submitCategory(category)
  }

  useMyTurnAlert({
    isMyTurn: isMyTurn && !submitted,
    onAlert: () => {
      setTurnCallout(Date.now())
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

  useShortcuts(wide && isMyTurn, { onRoll: handleRoll, dispatch })

  const turnStrip = (
    <TurnStrip activePlayerId={activePlayerId} players={turnPlayers} you={session.you} />
  )

  const diceScene = controller ? (
    <GameControllerPad activePlayer={activePlayer} isMyTurn={isMyTurn} roll={roll} />
  ) : (
    <GameDiceTray
      activePlayer={activePlayer}
      guided={guide !== undefined}
      isMyTurn={isMyTurn}
      onTurnCalloutDone={() => setTurnCallout(null)}
      roll={roll}
      roundNumber={roundNumber}
      turnCallout={turnCallout}
      wide={wide}
    />
  )

  const header = (
    <GamePlayHeader
      activePlayer={activePlayer}
      activePlayerId={activePlayerId}
      connectionStatus={connectionStatus}
      isMyTurn={isMyTurn}
      leaderLabel={leaderLabel}
      onHelp={() => setHelpOpen(true)}
      onLeave={onLeaveRequest}
      audioButtonRef={audioButtonRef}
      onOpenAudio={() => setAudioOpen(true)}
      chatButtonRef={chatButtonRef}
      chatUnread={chat.unread}
      onOpenChat={() => setChatOpen(true)}
      remainingMs={remainingMs}
      roundNumber={roundNumber}
      soundMuted={soundMuted}
      submitted={submitted}
      wide={wide}
    />
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

  const quickStrip = (
    <QuickCategoryStrip
      canPick={canPick}
      candidates={candidates}
      categories={openCategories}
      leverageCategory={leverageCategory}
      onPick={pickCategory}
      rolled={rolled}
    />
  )

  const canReleaseAll = keptCount > 0 && canHold

  const actions = (
    <GamePlayActions
      activePlayerName={activePlayer?.nickname}
      canReleaseAll={canReleaseAll}
      canRoll={canRoll}
      isMyTurn={isMyTurn}
      onReleaseAll={releaseAll}
      onRoll={handleRoll}
      rolling={rolling}
      submitted={submitted}
      submitting={submitting}
      wide={wide}
    />
  )

  const scoreSheet = (className: string, header?: ReactNode) => (
    <ScoreSheet
      activePlayerId={activePlayerId}
      candidates={candidates}
      canPick={canPick}
      className={className}
      {...(wide ? { 'data-tutorial': 'sheet' } : {})}
      header={header}
      leverageCategory={leverageCategory}
      onPick={pickCategory}
      players={sheetPlayers}
      you={session.you}
    />
  )

  const activePlayerName = activePlayer?.nickname
  const sheetHint = scoreSheetHint(isMyTurn, rolled, activePlayerName)
  const recordTitle = scoreRecordTitle(isMyTurn, activePlayerName)

  return (
    <>
      <GamePlayBoard
        actions={actions}
        connectionStatus={connectionStatus}
        diceScene={diceScene}
        guideOverlay={guide?.({
          rolled,
          keptValues: local.dice ? local.dice.filter((_value, index) => local.held[index]) : [],
          rolling,
          submitted,
          rollCount: local.rollCount,
          candidates,
          motionNoticeVisible: canOfferMotion(roll.motion.availability),
          wide,
        })}
        header={header}
        onSheetToggle={setSheetOpen}
        openCount={openCategories.length}
        players={snapshot.players}
        quickStrip={quickStrip}
        recordTitle={recordTitle}
        scoreSheet={scoreSheet}
        sheetHint={sheetHint}
        sheetOpen={sheetOpen}
        turnStrip={turnStrip}
        wide={wide}
      />

      <ToastHost message={toastMessage} />
      <AudioPopover
        anchorRef={audioButtonRef}
        muted={soundMuted}
        onClose={() => setAudioOpen(false)}
        onToggleMute={toggleSound}
        open={audioOpen}
      />
      <ChatDialog
        anchorRef={chatButtonRef}
        chat={chat}
        layout={wide ? 'wide' : 'narrow'}
        onClose={() => setChatOpen(false)}
        open={chatOpen}
        you={session.you}
      />
      {zeroModal}
      <GameHelpModal
        onClose={() => setHelpOpen(false)}
        open={helpOpen}
        timed={roundDeadline !== null}
      />
    </>
  )
}
