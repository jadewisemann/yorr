import { useEffect } from 'react'
import { Ammo } from '@/duel/components/Ammo'
import { Gunslinger } from '@/duel/components/Gunslinger'
import { ResultBackdrop } from '@/duel/components/ResultBackdrop'
import { type DuelOutcome, duelOutcome } from '@/duel/domain/duel'
import { OUTFIT_LEFT, OUTFIT_RIGHT } from '@/duel/domain/fighter'
import type { DuelState, RoomSnapshot } from '@/realtime/wsEvents'
import { isRoomHost } from '@/room/api/roomApi'
import { useReturnToLobby } from '@/room/api/useGameApi'
import { Button } from '@/shared/components/Button'
import { LOSE_VIBRATION, vibrate, WIN_VIBRATION } from '@/shared/vibrate'
import type { ActiveRoomSession } from '@/store'

interface DuelResultProps {
  onLeaveRequest: () => void
  session: ActiveRoomSession
  snapshot: RoomSnapshot
}

const OUTCOME_COLOR: Record<DuelOutcome, string> = {
  draw: 'var(--ds-duel-ink)',
  lost: 'var(--ds-duel-danger)',
  won: 'var(--ds-duel-positive)',
}

const OUTCOME_HEADING: Record<DuelOutcome, string> = {
  draw: '비겼다',
  lost: '쓰러졌다',
  won: '살아남았다',
}

export function DuelResult({ onLeaveRequest, session, snapshot }: DuelResultProps) {
  const returnToLobby = useReturnToLobby()
  const state = snapshot.game as unknown as DuelState | undefined
  const dashboard = session.membershipRole === 'dashboard'
  const opponent = snapshot.players.find((player) => player.playerId !== session.you)
  const myHp = state?.hp[session.you] ?? 0
  const opponentHp = opponent ? (state?.hp[opponent.playerId] ?? 0) : 0
  const outcome = duelOutcome({
    fallenId: state?.lastRound?.koId,
    myHp,
    opponentHp,
    you: session.you,
  })
  const won = outcome === 'won'

  useEffect(() => {
    if (dashboard || outcome === 'draw') return
    vibrate(outcome === 'won' ? WIN_VIBRATION : LOSE_VIBRATION)
  }, [dashboard, outcome])

  if (dashboard) {
    return <DuelDashboardResult onClose={onLeaveRequest} snapshot={snapshot} state={state} />
  }

  const host = isRoomHost(snapshot, session.you)

  return (
    <ResultBackdrop>
      <div className="flex items-end" style={{ height: 'clamp(150px, 22vh, 260px)' }}>
        <Gunslinger
          flip={outcome === 'lost'}
          height="100%"
          outfit={won ? OUTFIT_LEFT : OUTFIT_RIGHT}
          pose="ready"
        />
      </div>

      <p
        className="m-0 font-mono text-2xs tracking-[0.3em] uppercase"
        style={{ color: 'var(--ds-duel-accent)' }}
      >
        {outcome === 'draw' ? 'Standoff' : 'Last man standing'}
      </p>
      <h1
        className="m-0 font-black"
        style={{
          color: OUTCOME_COLOR[outcome],
          fontSize: 'clamp(2.25rem, 6vw, 4.5rem)',
        }}
      >
        {OUTCOME_HEADING[outcome]}
      </h1>

      <section className="flex items-center gap-6 rounded-sheet border border-white/15 bg-white/8 px-8 py-6 backdrop-blur-md">
        <Ammo hp={myHp} name="나" outfit={OUTFIT_LEFT} />
        <span className="text-2xl text-game-separator">:</span>
        <Ammo hp={opponentHp} name={opponent?.nickname ?? '상대'} outfit={OUTFIT_RIGHT} />
      </section>

      <div className="grid w-full max-w-sm gap-3">
        {host ? (
          <Button
            loading={returnToLobby.isLoading}
            onClick={() => void returnToLobby.execute()}
            size="lg"
          >
            대기실로 돌아가기
          </Button>
        ) : (
          <p className="m-0 text-center text-sm text-game-content-muted">
            호스트가 재대결을 준비하고 있어요.
          </p>
        )}
        <Button onClick={onLeaveRequest} size="lg" variant="secondary">
          방 나가기
        </Button>
      </div>
    </ResultBackdrop>
  )
}

export function DuelDashboardResult({
  onClose,
  snapshot,
  state,
}: {
  onClose: () => void
  snapshot: RoomSnapshot
  state: DuelState | undefined
}) {
  const nameOf = (playerId: string | undefined) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '?'
  const [first, second] = state?.playerOrder ?? []
  const fallen = state?.lastRound?.koId
  const survivor = fallen === first ? second : fallen === second ? first : undefined

  return (
    <ResultBackdrop>
      <div className="flex items-end" style={{ height: 'clamp(150px, 22vh, 260px)' }}>
        <Gunslinger
          flip={survivor === second}
          height="100%"
          outfit={survivor === second ? OUTFIT_RIGHT : OUTFIT_LEFT}
          pose="ready"
        />
      </div>

      <p
        className="m-0 font-mono text-2xs tracking-[0.3em] uppercase"
        style={{ color: 'var(--ds-duel-accent)' }}
      >
        {survivor ? 'Last man standing' : 'Standoff'}
      </p>
      <h1
        className="m-0 font-black"
        style={{
          color: survivor ? 'var(--ds-duel-positive)' : 'var(--ds-duel-ink)',
          fontSize: 'clamp(2.25rem, 6vw, 4.5rem)',
        }}
      >
        {survivor ? `${nameOf(survivor)} 승리` : '무승부'}
      </h1>

      <section className="flex items-center gap-6 rounded-sheet border border-white/15 bg-white/8 px-8 py-6 backdrop-blur-md">
        <Ammo hp={state?.hp[first ?? ''] ?? 0} name={nameOf(first)} outfit={OUTFIT_LEFT} />
        <span className="text-2xl text-game-separator">:</span>
        <Ammo hp={state?.hp[second ?? ''] ?? 0} name={nameOf(second)} outfit={OUTFIT_RIGHT} />
      </section>

      <p className="m-0 text-center text-sm text-game-content-muted">
        방장이 폰에서 재대결을 시작할 수 있어요.
      </p>
      <Button onClick={onClose} size="lg" variant="secondary">
        방 닫기
      </Button>
    </ResultBackdrop>
  )
}
