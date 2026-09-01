import type { Player, PlayerId } from '@/realtime/wsEvents'
import { PlayerCard } from '@/room/components/PlayerCard'

export function ParticipantColumn({
  capacity,
  hostId,
  players,
}: {
  capacity: number
  hostId: PlayerId | undefined
  players: Player[]
}) {
  const emptySeats = Math.max(0, capacity - players.length)

  return (
    <section
      aria-label={`참가자 ${players.length}명`}
      className="flex min-h-0 flex-col border-l border-border"
    >
      <div className="flex flex-none items-baseline justify-between gap-3 px-3 pt-2.5 pb-1.5">
        <h2 className="m-0 text-sm font-bold tracking-[0.02em] whitespace-nowrap">참가자</h2>
        <p className="m-0 font-mono text-xs tabular-nums text-content-faint">
          {players.length} / {capacity}
        </p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto px-3 pb-3">
        {players.map((player) => (
          <PlayerCard
            avatarSeed={player.playerId}
            key={player.playerId}
            name={player.nickname}
            status={player.status}
            subtitle={player.kind === 'BOT' ? '상태 기반 AI 봇' : undefined}
            trailing={
              player.playerId === hostId ? (
                <span className="rounded-chip bg-border px-1.5 py-0.5 font-mono text-2xs font-bold tracking-[0.1em] text-content-muted">
                  방장
                </span>
              ) : undefined
            }
          />
        ))}
        {players.length === 0 && (
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-border-raised px-3 text-sm text-content-muted">
            아직 아무도 없어요 · QR을 찍어 주세요
          </p>
        )}
        {emptySeats > 0 && players.length > 0 && (
          <p className="m-0 flex min-h-[4.25rem] items-center gap-3 rounded-panel border border-dashed border-border-raised px-3 text-sm text-content-muted tabular-nums">
            <span
              aria-hidden="true"
              className="size-11 flex-none rounded-card border border-dashed border-border-strong"
            />
            빈 자리 {emptySeats}
          </p>
        )}
      </div>
    </section>
  )
}
