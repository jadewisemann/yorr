import { msLabel } from '@/duel/domain/duel'
import type { ArenaPhase, Fighter } from '@/duel/domain/fighter'
import { LABEL_MONO } from './label'
import { FoulLine, ShotLine, TieLine, WRAP } from './resultLines'

/* 단계 안내선 — Headline이 phase에 맞는 한 줄을 고른다. */

export function Headline({
  actLabel,
  foulSide,
  hint,
  ko,
  landMs,
  left,
  maxFouls,
  pending,
  phase,
  right,
  selfShot,
  tie,
  winner,
}: {
  actLabel: string
  foulSide: 0 | 1 | 2
  hint: string
  ko: boolean
  landMs: number
  left: Fighter
  maxFouls: number
  pending: boolean
  phase: ArenaPhase
  right: Fighter
  selfShot: boolean
  tie: boolean
  winner: 0 | 1 | 2
}) {
  if (phase === 'waiting') return <HoldLine hint={hint} />
  if (phase === 'signal') return <DrawLine actLabel={actLabel} />
  if (pending) return <PendingLine ms={left.ms} />
  if (foulSide !== 0) {
    return (
      <FoulLine
        landMs={landMs}
        maxFouls={maxFouls}
        selfShot={selfShot}
        who={foulSide === 1 ? left : right}
      />
    )
  }
  if (tie) return <TieLine landMs={landMs} left={left} right={right} />
  if (winner === 0) return null
  return <ShotLine ko={ko} landMs={landMs} shooter={winner === 1 ? left : right} />
}

function HoldLine({ hint }: { hint: string }) {
  return (
    <div className={WRAP} style={{ top: '31%' }}>
      <div
        className={`animate-pulse ${LABEL_MONO}`}
        style={{ color: '#ffb98a', letterSpacing: '0.34em' }}
      >
        H O L D
      </div>
      <div className="mt-1.5 text-sm font-bold" style={{ color: 'rgb(255 226 196 / 72%)' }}>
        {hint}
      </div>
    </div>
  )
}

function DrawLine({ actLabel }: { actLabel: string }) {
  return (
    <div className={WRAP} style={{ top: '25%' }}>
      <div
        className="animate-duel-signal-pop font-black"
        style={{
          color: '#f0fff5',
          fontSize: 'clamp(48px, 15vw, 104px)',
          letterSpacing: '-0.02em',
          lineHeight: 0.92,
          textShadow: '0 0 34px rgb(74 222 128 / 95%), 0 4px 0 #14532d',
        }}
      >
        DRAW!
      </div>
      <div
        className="mt-1 font-black tracking-[0.3em]"
        style={{ color: '#dcfce7', fontSize: 'clamp(13px, 3.4vw, 18px)' }}
      >
        {actLabel}
      </div>
    </div>
  )
}

function PendingLine({ ms }: { ms: number | null }) {
  return (
    <div className={WRAP} style={{ top: '28%' }}>
      <div className="text-4xl font-black tabular-nums" style={{ color: '#ffe9c2' }}>
        {msLabel(ms)}
      </div>
      <div className="mt-2 animate-pulse text-sm" style={{ color: 'rgb(255 220 190 / 72%)' }}>
        상대가 뽑는 걸 기다린다…
      </div>
    </div>
  )
}
