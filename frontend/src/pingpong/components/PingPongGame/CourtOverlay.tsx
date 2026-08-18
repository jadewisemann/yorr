import type { ReactNode } from 'react'
import { ComboBadge } from '@/pingpong/components/ComboBadge'
import { Score } from '@/pingpong/components/Score'
import {
  feedbackTextClass,
  pingPongSituation,
  sharedEventLabel,
  sharedSituationLabel,
} from '@/pingpong/feedback'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'

export function CourtOverlay({
  badge,
  clock,
  preparation,
  snapshot,
  state,
}: {
  badge: string
  clock: number
  preparation?: ReactNode
  snapshot: RoomSnapshot
  state: PingPongState
}) {
  const firstPlayerId = state.playerOrder[0] ?? ''
  const secondPlayerId = state.playerOrder[1] ?? ''
  const firstPlayer = snapshot.players.find((player) => player.playerId === firstPlayerId)
  const secondPlayer = snapshot.players.find((player) => player.playerId === secondPlayerId)
  const countdown =
    state.phase === 'COUNTDOWN' ? Math.max(1, Math.ceil((state.nextActionAt - clock) / 1_000)) : 0
  const event = state.lastEvent
  const eventAge = event ? clock - event.at : Number.POSITIVE_INFINITY
  const actor = snapshot.players.find((player) => player.playerId === event?.playerId)
  const label = event ? sharedEventLabel(event.type, actor?.nickname ?? '플레이어') : null
  const situationLabel = dashboardSituationLabel(
    state,
    firstPlayerId,
    secondPlayerId,
    firstPlayer?.nickname ?? 'P1',
    secondPlayer?.nickname ?? 'P2',
  )

  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
        <Score
          name={firstPlayer?.nickname ?? 'P1'}
          score={state.scores[firstPlayerId] ?? 0}
          tag="P1"
          tone="blue"
        />
        <div className="mt-1 rounded-full border border-border-raised bg-black/35 px-3 py-1.5 text-center font-mono text-xs tracking-[0.14em] backdrop-blur-md">
          {badge}
        </div>
        <Score
          name={secondPlayer?.nickname ?? 'P2'}
          score={state.scores[secondPlayerId] ?? 0}
          tag="P2"
          tone="red"
        />
      </header>
      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="grid size-32 place-items-center rounded-full border border-border-strong bg-black/45 font-mono text-7xl font-black backdrop-blur-md">
            {countdown}
          </div>
        </div>
      )}
      {preparation}
      <DashboardFeedback
        event={event}
        eventAge={eventAge}
        eventLabel={label}
        rally={state.rally}
        situationLabel={situationLabel}
      />
      {event?.type === 'SMASH' && eventAge < 220 && (
        <div className="animate-pp-smash-flash pointer-events-none absolute inset-0 z-[5] bg-[radial-gradient(circle_at_50%_55%,rgb(255_150_110_/_45%),transparent_70%)]" />
      )}
    </>
  )
}

export function dashboardSituationLabel(
  state: PingPongState,
  firstPlayerId: string,
  secondPlayerId: string,
  firstName: string,
  secondName: string,
) {
  if (state.phase !== 'COUNTDOWN') return null
  return sharedSituationLabel(
    pingPongSituation(state.scores[firstPlayerId] ?? 0, state.scores[secondPlayerId] ?? 0),
    firstName,
    secondName,
  )
}

export function DashboardFeedback({
  event,
  eventAge,
  eventLabel,
  rally,
  situationLabel,
}: {
  event: PingPongState['lastEvent']
  eventAge: number
  eventLabel: string | null
  rally: number
  situationLabel: string | null
}) {
  const showEvent = Boolean(eventLabel && event && eventAge < 900)
  const label = showEvent ? eventLabel : situationLabel
  const tone = showEvent && event ? feedbackTextClass(event.type) : 'text-pp-gold'
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[17%] z-10 grid justify-items-center gap-3 text-center">
      <div
        className={`min-h-12 text-4xl font-black drop-shadow-[0_3px_12px_rgb(0_0_0_/_80%)] ${tone}`}
      >
        {label && <span className="animate-pp-feedback-pop">{label}</span>}
      </div>
      {rally > 0 && <ComboBadge count={rally} />}
    </div>
  )
}
