import { ActionPanel } from '@/davinci/components/DavinciGame/ActionPanel'
import { TileRack } from '@/davinci/components/TileRack'
import { TurnBar } from '@/davinci/components/TurnBar'
import { hiddenCount, isEliminated, lastEventMessage, promptOf } from '@/davinci/domain/davinci'
import { useDavinciGame } from '@/davinci/model/useDavinciGame'
import { useSecondsLeft } from '@/davinci/model/useSecondsLeft'
import type { DavinciView, RoomSnapshot } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { GameCanvas } from '@/shared/components/Screen'
import type { ActiveRoomSession } from '@/store'

interface DavinciGameProps {
  onLeaveRequest: () => void
  roomId: string
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

/**
 * 다빈치 코드 진행 화면.
 *
 * 서버가 보내는 시점(`snapshot.game`)은 **보는 사람마다 다르다** — 남의 감춘 타일은
 * 숫자가 지워진 채로 온다. 그래서 이 화면은 "가릴 것을 가리는" 일을 하지 않는다.
 * 받은 것을 그대로 그리면 그것이 곧 그 사람이 알아도 되는 전부다.
 */
export function DavinciGame({ onLeaveRequest, roomId, session, snapshot }: DavinciGameProps) {
  const state = snapshot.game as unknown as DavinciView | undefined
  const you = session.you
  const { decide, guess, number, place, selectNumber, selectTile, selection, sendError } =
    useDavinciGame({ roomId, state, you })
  const secondsLeft = useSecondsLeft(state?.nextActionAt ?? 0)

  const nameOf = (playerId: string): string =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '상대'

  if (!state) {
    return (
      <GameCanvas className="grid place-items-center bg-dv-canvas text-game-content-muted">
        타일을 나누고 있어요.
      </GameCanvas>
    )
  }

  // 대시보드는 판의 당사자가 아니다 — 감춘 숫자를 하나도 받지 않으므로 관전만 한다.
  const spectating = session.membershipRole === 'dashboard' || !state.playerOrder.includes(you)
  const prompt = spectating ? 'wait' : promptOf(state, you)
  const others = state.playerOrder.filter((playerId) => playerId !== you)
  const myHand = state.hands[you] ?? []

  return (
    <GameCanvas className="flex flex-col gap-3 bg-dv-canvas px-4 pt-safe-top pb-safe-bottom">
      <div className="flex items-start gap-2 pt-2">
        <div className="min-w-0 flex-1">
          <TurnBar
            deckCount={state.deckCount}
            message={lastEventMessage(state, nameOf)}
            mine={state.turnPlayerId === you}
            secondsLeft={secondsLeft}
            turnName={nameOf(state.turnPlayerId)}
          />
        </div>
        <GameChromeButton onClick={onLeaveRequest} tone="overlay" type="button">
          나가기
        </GameChromeButton>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto">
        {others.map((playerId) => (
          <TileRack
            eliminated={isEliminated(state, playerId)}
            hidden={hiddenCount(state, playerId)}
            key={playerId}
            name={nameOf(playerId)}
            onSelectTile={
              prompt === 'guess' && !isEliminated(state, playerId)
                ? (tileId) => selectTile(playerId, tileId)
                : undefined
            }
            selectedTileId={selection?.playerId === playerId ? selection.tileId : null}
            tiles={state.hands[playerId] ?? []}
            turn={state.turnPlayerId === playerId}
          />
        ))}
        {!spectating && (
          <TileRack
            eliminated={isEliminated(state, you)}
            hidden={hiddenCount(state, you)}
            mine
            name={nameOf(you)}
            tiles={myHand}
            turn={state.turnPlayerId === you}
          />
        )}
      </div>

      <ActionPanel
        drawn={state.drawn ?? null}
        drawnLabel={
          state.turnPlayerId === you && !spectating
            ? '내가 뽑은 타일'
            : `${nameOf(state.turnPlayerId)}가 뽑은 타일`
        }
        hand={myHand}
        number={number}
        onDecide={decide}
        onGuess={guess}
        onPick={selectNumber}
        onPlace={place}
        prompt={prompt}
        sendError={sendError}
        spectating={spectating}
        targetName={selection === null ? null : nameOf(selection.playerId)}
        turnName={nameOf(state.turnPlayerId)}
      />
    </GameCanvas>
  )
}
