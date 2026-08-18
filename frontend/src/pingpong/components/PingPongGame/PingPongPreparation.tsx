import type { ReactNode } from 'react'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'

export function PingPongPreparation({
  action,
  heading,
  snapshot,
  state,
}: {
  action?: ReactNode
  heading: string
  snapshot: RoomSnapshot
  state: PingPongState
}) {
  const latestPractice =
    state.lastEvent?.type === 'PRACTICE'
      ? snapshot.players.find((player) => player.playerId === state.lastEvent?.playerId)
      : null

  return (
    <section className="absolute inset-0 z-10 grid place-items-center bg-black/45 px-5 backdrop-blur-[2px]">
      <div className="grid w-full max-w-xl gap-6 rounded-hero border border-border-raised bg-pp-surface/95 p-7 text-center shadow-2xl">
        <div>
          <p className="m-0 font-mono text-xs tracking-[0.2em] text-pp-side-blue-text">WARM-UP</p>
          <h1 className="mt-2 mb-0 text-4xl font-black">{heading}</h1>
          <p className="mt-2 mb-0 text-game-content-muted">
            두 명 모두 준비 완료하면 경기가 시작됩니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {state.playerOrder.map((playerId, index) => {
            const player = snapshot.players.find((candidate) => candidate.playerId === playerId)
            const ready = state.readyPlayerIds.includes(playerId)
            return (
              <div
                className={`rounded-card border px-4 py-4 ${ready ? 'border-pp-accent/45 bg-pp-accent/12' : 'border-border bg-white/6'}`}
                key={playerId}
              >
                <span className="block truncate text-lg font-black">
                  {player?.nickname ?? `P${index + 1}`}
                </span>
                <span className={ready ? 'text-pp-accent-text' : 'text-game-content-faint'}>
                  {ready ? '준비 완료' : '연습 중'}
                </span>
              </div>
            )
          })}
        </div>
        <p className="m-0 min-h-6 text-lg font-bold text-pp-gold" role="status">
          {latestPractice ? `${latestPractice.nickname} 연습 스윙 감지!` : '공을 한 번 쳐보세요'}
        </p>
        {action}
      </div>
    </section>
  )
}
