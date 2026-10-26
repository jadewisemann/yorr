import type { ReactNode } from 'react'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'
import { GamePlayBoard } from '@/yacht/components/GamePlay/GamePlayBoard'
import { TurnStrip } from '@/yacht/components/TurnStrip'
import type { YachtCategory } from '@/yacht/domain/scoring'
import { scoreRecordTitle, scoreSheetHint } from '@/yacht/model/gamePlayLabels'
import type { TurnProgress } from '@/yacht/model/gamePlayView'
import {
  GamePlayActionsSlot,
  GamePlayChatOverlay,
  GamePlayChatPanel,
  GamePlayDiceScene,
  GamePlayHeaderSlot,
  GamePlayOverlays,
  GamePlayQuickStrip,
  GamePlayScoreSheet,
} from './GamePlaySlots'
import { turnProgressOf, useGamePlayScreen } from './useGamePlayScreen'

interface GamePlayProps {
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
  onLeaveRequest: () => void
  guide?: (progress: TurnProgress) => ReactNode
  leverageCategory?: YachtCategory | null
  forceController?: boolean
}

/*
 * 상태는 `useGamePlayScreen` 한 곳에서 만들고, 이 화면은 그것을 게임판의 구획(헤더·턴 줄·
 * 주사위·채팅·버튼·점수표)에 나눠 꽂기만 한다. 넓은/좁은 화면의 갈림은 여기서 한눈에 보인다.
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
  const screen = useGamePlayScreen({ forceController, leverageCategory, roomId, session, snapshot })
  const { chrome, turn, view, wide } = screen
  const activePlayerName = view.activePlayer?.nickname

  return (
    <>
      <GamePlayBoard
        actions={<GamePlayActionsSlot screen={screen} />}
        chatOverlay={wide ? null : <GamePlayChatOverlay screen={screen} />}
        chatPanel={wide ? <GamePlayChatPanel screen={screen} /> : null}
        connectionStatus={screen.connectionStatus}
        diceScene={<GamePlayDiceScene guided={guide !== undefined} screen={screen} />}
        guideOverlay={guide?.(turnProgressOf(screen))}
        header={<GamePlayHeaderSlot onLeave={onLeaveRequest} screen={screen} />}
        onSheetToggle={chrome.setSheetOpen}
        openCount={view.openCategories.length}
        players={snapshot.players}
        quickStrip={<GamePlayQuickStrip screen={screen} />}
        recordTitle={scoreRecordTitle(turn.isMyTurn, activePlayerName)}
        scoreSheet={(className, header) => (
          <GamePlayScoreSheet className={className} header={header} screen={screen} />
        )}
        sheetHint={scoreSheetHint(turn.isMyTurn, view.rolled, activePlayerName)}
        sheetOpen={chrome.sheetOpen}
        turnStrip={
          <TurnStrip
            activePlayerId={turn.activePlayerId}
            players={view.turnPlayers}
            you={session.you}
          />
        }
        wide={wide}
      />
      <GamePlayOverlays screen={screen} />
    </>
  )
}
