import { Score } from '@/pingpong/components/Score'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { Button } from '@/shared/components/Button'
import { GameCanvas } from '@/shared/components/Screen'
import type { ActiveRoomSession } from '@/store'

interface PingPongResultProps {
  onLeaveRequest: () => void
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function PingPongResult({ onLeaveRequest, session, snapshot }: PingPongResultProps) {
  const returnToLobby = useReturnToLobby()
  const state = snapshot.game as unknown as PingPongState | undefined
  const dashboard = session.membershipRole === 'dashboard'

  if (dashboard) {
    return <PingPongDashboardResult onClose={onLeaveRequest} snapshot={snapshot} state={state} />
  }

  const opponent = snapshot.players.find((player) => player.playerId !== session.you)
  const myScore = state?.scores[session.you] ?? 0
  const opponentScore = opponent ? (state?.scores[opponent.playerId] ?? 0) : 0
  const won = myScore > opponentScore
  const host = isRoomHost(snapshot, session.you)

  return (
    <GameCanvas className="flex flex-col items-center justify-center gap-6 bg-pp-canvas px-gutter text-white">
      <div className="absolute inset-0 [background:radial-gradient(circle_at_50%_30%,rgb(43_143_224_/_20%),transparent_45%)]" />
      <p className="relative m-0 font-mono text-xs tracking-[0.22em] text-game-content-muted">
        MATCH FINISHED
      </p>
      <h1 className="relative m-0 text-5xl font-black">{won ? '승리!' : '좋은 경기였어요'}</h1>
      <section className="relative flex items-center gap-6 rounded-sheet border border-border-raised bg-surface-veil px-8 py-7 backdrop-blur-md">
        <Score name="나" score={myScore} tone="blue" large />
        <span className="text-2xl text-game-separator">:</span>
        <Score name={opponent?.nickname ?? '상대'} score={opponentScore} tone="red" large />
      </section>
      <div className="relative grid w-full max-w-sm gap-3">
        {host ? (
          <Button
            size="lg"
            loading={returnToLobby.isLoading}
            onClick={() => void returnToLobby.execute()}
          >
            대기실로 돌아가기
          </Button>
        ) : (
          <p className="m-0 text-center text-sm text-game-content-muted">
            호스트가 재대결을 준비하고 있어요.
          </p>
        )}
        <Button size="lg" onClick={onLeaveRequest} variant="secondary">
          방 나가기
        </Button>
      </div>
    </GameCanvas>
  )
}

export function PingPongDashboardResult({
  onClose,
  snapshot,
  state,
}: {
  onClose: () => void
  snapshot: RoomSnapshot
  state: PingPongState | undefined
}) {
  const firstPlayerId = state?.playerOrder[0] ?? ''
  const secondPlayerId = state?.playerOrder[1] ?? ''
  const firstPlayer = snapshot.players.find((player) => player.playerId === firstPlayerId)
  const secondPlayer = snapshot.players.find((player) => player.playerId === secondPlayerId)

  return (
    <GameCanvas className="flex flex-col items-center justify-center gap-6 bg-pp-canvas px-gutter text-white">
      <p className="m-0 font-mono text-xs tracking-[0.22em] text-game-content-muted">
        MATCH FINISHED
      </p>
      <h1 className="m-0 text-5xl font-black">경기 종료</h1>
      <section className="flex items-center gap-6 rounded-sheet border border-border-raised bg-surface-veil px-8 py-7">
        <Score
          name={firstPlayer?.nickname ?? 'P1'}
          score={state?.scores[firstPlayerId] ?? 0}
          tone="blue"
          large
        />
        <span className="text-2xl text-game-separator">:</span>
        <Score
          name={secondPlayer?.nickname ?? 'P2'}
          score={state?.scores[secondPlayerId] ?? 0}
          tone="red"
          large
        />
      </section>
      <p className="m-0 text-center text-sm text-game-content-muted">
        방장이 폰에서 재대결을 준비할 수 있어요.
      </p>
      <Button size="lg" onClick={onClose} variant="secondary">
        방 닫기
      </Button>
    </GameCanvas>
  )
}
