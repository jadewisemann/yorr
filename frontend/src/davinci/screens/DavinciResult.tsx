import { TileRack } from '@/davinci/components/TileRack'
import { hiddenCount, scoreOf } from '@/davinci/domain/davinci'
import type { DavinciView, RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { Button } from '@/shared/components/Button'
import { GameCanvas } from '@/shared/components/Screen'
import type { ActiveRoomSession } from '@/store'

interface DavinciResultProps {
  onLeaveRequest: () => void
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

/**
 * 판이 끝난 화면. 끝나는 순간 모든 타일이 공개되므로 **손패를 그대로 펼쳐 보여 준다** —
 * 마지막까지 무엇을 감추고 있었는지가 이 게임의 결과 그 자체다.
 */
export function DavinciResult({ onLeaveRequest, session, snapshot }: DavinciResultProps) {
  const returnToLobby = useReturnToLobby()
  const state = snapshot.game as unknown as DavinciView | undefined
  const host = isRoomHost(snapshot, session.you)
  const spectating = session.membershipRole === 'dashboard'

  const nameOf = (playerId: string): string =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '상대'

  const winnerId = state?.winnerId ?? null
  const ranked = [...(state?.playerOrder ?? [])].sort(
    (left, right) => scoreOf(state, right) - scoreOf(state, left),
  )

  return (
    <GameCanvas className="flex flex-col gap-4 overflow-y-auto bg-dv-canvas px-4 pt-safe-top pb-safe-bottom">
      <header className="grid gap-1 pt-6 text-center">
        <p className="m-0 font-mono text-2xs text-game-content-faint uppercase tracking-[0.3em]">
          Da Vinci Code
        </p>
        <h1 className="m-0 font-black text-4xl text-content">
          {winnerId === null
            ? '판이 끝났어요'
            : winnerId === session.you && !spectating
              ? '지켜냈다'
              : `${nameOf(winnerId)} 승리`}
        </h1>
      </header>

      <ol className="m-0 grid list-none gap-2 p-0">
        {ranked.map((playerId, rank) => (
          <li className="grid gap-1" key={playerId}>
            <div className="flex items-baseline justify-between gap-2 px-1">
              <span className="truncate font-bold text-game-content text-sm">
                {rank + 1}위 · {nameOf(playerId)}
              </span>
              <span className="shrink-0 font-mono text-2xs text-game-content-faint uppercase tracking-[0.18em]">
                {scoreOf(state, playerId)}점 · 맞힘 {state?.hits[playerId] ?? 0}
              </span>
            </div>
            <TileRack
              hidden={hiddenCount(state, playerId)}
              mine={playerId === session.you && !spectating}
              name={nameOf(playerId)}
              tiles={state?.hands[playerId] ?? []}
            />
          </li>
        ))}
      </ol>

      <div className="grid gap-3 pb-2">
        {host ? (
          <Button
            loading={returnToLobby.isLoading}
            onClick={() => void returnToLobby.execute()}
            size="lg"
          >
            대기실로 돌아가기
          </Button>
        ) : (
          <p className="m-0 text-center text-game-content-muted text-sm">
            호스트가 다음 판을 준비하고 있어요.
          </p>
        )}
        <Button onClick={onLeaveRequest} size="lg" variant="secondary">
          방 나가기
        </Button>
      </div>
    </GameCanvas>
  )
}
