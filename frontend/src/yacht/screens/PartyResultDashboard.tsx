import type { RoomSnapshot } from '@/realtime/wsEvents'
import { Button } from '@/shared/components/Button'
import { PlayBoard } from '@/shared/components/Screen'
import { useWideLayout } from '@/shared/useWideLayout'
import type { ActiveRoomSession } from '@/store'
import { type RankedPlayer, ResultRanking } from '@/yacht/components/ResultRanking'
import { ScoreMatrix } from '@/yacht/components/ScoreMatrix'

interface PartyResultDashboardProps {
  onLeaveRequest: () => void
  ranked: RankedPlayer[]
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

export function PartyResultDashboard({
  onLeaveRequest,
  ranked,
  session,
  snapshot,
}: PartyResultDashboardProps) {
  const wide = useWideLayout()
  const winner = ranked[0]

  return (
    <PlayBoard wide={wide}>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-none items-center gap-3 border-b border-border px-gutter py-3">
          <div className="grid min-w-0 flex-1 gap-1">
            <h1 className="m-0 text-lg font-bold">최종 결과 · 요트 다이스</h1>
            <p className="m-0 flex items-center gap-2 text-xs text-content-muted">
              <span className="font-mono font-bold tracking-[0.12em] text-content">
                {session.roomCode}
              </span>
              <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
              참가자 {ranked.length}명
            </p>
          </div>
          <Button
            className="flex-none px-3.5 text-sm"
            onClick={onLeaveRequest}
            type="button"
            variant="danger"
          >
            방 닫기
          </Button>
        </header>

        <p className="m-0 flex flex-none items-center gap-2 border-b border-border px-gutter py-2.5 text-xs text-content-muted">
          {snapshot.game?.roundNumber ?? 12}라운드 종료
          {winner && (
            <>
              <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
              <span className="truncate">
                우승 <span className="font-bold text-content">{winner.nickname}</span>
              </span>
            </>
          )}
        </p>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-gutter py-4">
          <h2 className="m-0 flex-none font-mono text-xs font-bold tracking-[0.16em] text-content-muted uppercase">
            Final Standings
          </h2>
          <ResultRanking
            className="min-h-0 flex-1 auto-rows-min content-start overflow-y-auto text-[1.15em]"
            players={ranked}
            you={session.you}
          />
        </div>

        <footer className="flex flex-none items-center justify-center border-t border-border px-gutter py-4">
          <p className="m-0 text-center text-sm text-content-muted" role="status">
            방장이 대기실로 옮기면 같은 멤버로 다시 시작해요.
          </p>
        </footer>
      </div>

      {wide && (
        <section aria-label="전체 점수표" className="flex min-h-0 flex-col border-l border-border">
          <h2 className="m-0 flex-none px-3 pt-2.5 pb-1.5 text-sm font-bold tracking-[0.02em]">
            전체 점수표
          </h2>
          <ScoreMatrix
            className="min-h-0 flex-1"
            players={ranked.map((player) => ({
              nickname: player.nickname,
              playerId: player.playerId,
              scoreboard: snapshot.game?.scores[player.playerId],
            }))}
          />
        </section>
      )}
    </PlayBoard>
  )
}
