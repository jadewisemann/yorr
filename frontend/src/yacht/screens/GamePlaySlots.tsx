import type { ReactNode } from 'react'
import { ChatOverlay } from '@/realtime/chat/ChatOverlay'
import { ChatPanel } from '@/realtime/chat/ChatPanel'
import { AudioPopover } from '@/shared/components/AudioPopover'
import { ToastHost } from '@/shared/components/ToastHost'
import { GameHelpModal } from '@/yacht/components/GameHelpModal'
import { GamePlayActions } from '@/yacht/components/GamePlay/GamePlayActions'
import { QuickCategoryStrip } from '@/yacht/components/GamePlay/QuickCategoryStrip'
import { ZeroScoreModal } from '@/yacht/components/GamePlay/ZeroScoreModal'
import { ScoreSheet } from '@/yacht/components/ScoreSheet'
import { GameControllerPad } from './GameController'
import { GameDiceTray } from './GameDiceTray'
import { GamePlayHeader } from './GamePlayHeader'
import type { GamePlayScreen } from './useGamePlayScreen'

interface ScreenProps {
  screen: GamePlayScreen
}

/** 폰 컨트롤러면 주사위 패드, 아니면 물리 주사위 트레이. */
export function GamePlayDiceScene({ guided, screen }: ScreenProps & { guided: boolean }) {
  const { chrome, roll, turn, view } = screen
  if (screen.controller) {
    return (
      <GameControllerPad activePlayer={view.activePlayer} isMyTurn={turn.isMyTurn} roll={roll} />
    )
  }
  return (
    <GameDiceTray
      activePlayer={view.activePlayer}
      guided={guided}
      isMyTurn={turn.isMyTurn}
      onTurnCalloutDone={() => chrome.setTurnCallout(null)}
      roll={roll}
      roundNumber={turn.roundNumber}
      turnCallout={chrome.turnCallout}
      wide={screen.wide}
    />
  )
}

export function GamePlayHeaderSlot({ onLeave, screen }: ScreenProps & { onLeave: () => void }) {
  const { chrome, turn, view } = screen
  return (
    <GamePlayHeader
      activePlayer={view.activePlayer}
      activePlayerId={turn.activePlayerId}
      connectionStatus={screen.connectionStatus}
      isMyTurn={turn.isMyTurn}
      leaderLabel={view.leaderLabel}
      onHelp={() => chrome.setHelpOpen(true)}
      onLeave={onLeave}
      audioButtonRef={chrome.audioButtonRef}
      onOpenAudio={() => chrome.setAudioOpen(true)}
      chatUnread={screen.chat.unread}
      onOpenChat={() => chrome.setChatOpen(true)}
      remainingMs={screen.remainingMs}
      roundNumber={turn.roundNumber}
      soundMuted={chrome.soundMuted}
      submitted={screen.roll.submitted}
      wide={screen.wide}
    />
  )
}

/*
 * 넓은 화면에서는 오른쪽 열에 채팅을 상주시킨다 — 점수표 옆에 자리가 있고, 대화를 보려고
 * 판 위에 창을 띄우면 그때마다 주사위가 가려진다. 좁은 화면은 그 자리가 없어 창을 쓴다.
 */
export function GamePlayChatPanel({ screen }: ScreenProps) {
  return (
    <ChatPanel
      chat={screen.chat}
      className="h-56 flex-none rounded-none border-0 border-t border-border bg-transparent"
      you={screen.you}
    />
  )
}

/*
 * 좁은 화면에서는 새 말만 잠깐 띄운다 — 판 위에 대화를 상주시키면 주사위를 계속 가리고,
 * 창을 열어야만 보이면 굴리는 중에 오간 말을 놓친다. 지나간 대화와 입력은 헤더 버튼이 여는
 * 시트가 맡는다.
 *
 * z-banner인 이유: 턴·족보 연출(`EffectCallout`, z-20)이 같은 자리에 뜬다. 아래에 깔리면
 * 연출 글자가 말풍선을 가로질러 둘 다 못 읽는다 — 4초 동안은 대화가 위에 있는 편이 낫다.
 */
export function GamePlayChatOverlay({ screen }: ScreenProps) {
  return (
    <ChatOverlay
      chat={screen.chat}
      onToggle={screen.chrome.setChatOpen}
      open={screen.chrome.chatOpen}
      peekClassName="absolute inset-x-gutter z-banner"
      you={screen.you}
    />
  )
}

export function GamePlayQuickStrip({ screen }: ScreenProps) {
  const { view } = screen
  return (
    <QuickCategoryStrip
      canPick={screen.roll.canPick}
      candidates={view.candidates}
      categories={view.openCategories}
      leverageCategory={screen.leverageCategory}
      onPick={screen.pickCategory}
      rolled={view.rolled}
    />
  )
}

export function GamePlayActionsSlot({ screen }: ScreenProps) {
  const { roll } = screen
  return (
    <GamePlayActions
      activePlayerName={screen.view.activePlayer?.nickname}
      canReleaseAll={roll.keptCount > 0 && roll.canHold}
      canRoll={roll.canRoll}
      isMyTurn={screen.turn.isMyTurn}
      onReleaseAll={roll.releaseAll}
      onRoll={roll.roll}
      rolling={roll.rolling}
      submitted={roll.submitted}
      submitting={roll.submitting}
      wide={screen.wide}
    />
  )
}

interface GamePlayScoreSheetProps extends ScreenProps {
  className: string
  header?: ReactNode
}

export function GamePlayScoreSheet({ className, header, screen }: GamePlayScoreSheetProps) {
  const { view } = screen
  return (
    <ScoreSheet
      activePlayerId={screen.turn.activePlayerId}
      candidates={view.candidates}
      canPick={screen.roll.canPick}
      className={className}
      {...(screen.wide ? { 'data-tutorial': 'sheet' } : {})}
      header={header}
      leverageCategory={screen.leverageCategory}
      onPick={screen.pickCategory}
      players={view.sheetPlayers}
      you={screen.you}
    />
  )
}

/** 판 바깥에 뜨는 것들 — 토스트, 소리 설정, 0점 확인, 도움말. */
export function GamePlayOverlays({ screen }: ScreenProps) {
  const { chrome, submitCategory } = screen
  return (
    <>
      <ToastHost message={screen.toast.message} />
      <AudioPopover
        anchorRef={chrome.audioButtonRef}
        muted={chrome.soundMuted}
        onClose={() => chrome.setAudioOpen(false)}
        onToggleMute={chrome.toggleSound}
        open={chrome.audioOpen}
      />
      <ZeroScoreModal
        category={chrome.zeroConfirm}
        onCancel={() => chrome.setZeroConfirm(null)}
        onConfirm={() => {
          const category = chrome.zeroConfirm
          chrome.setZeroConfirm(null)
          if (category) submitCategory(category)
        }}
      />
      <GameHelpModal
        onClose={() => chrome.setHelpOpen(false)}
        open={chrome.helpOpen}
        timed={screen.turn.roundDeadline !== null}
      />
    </>
  )
}
