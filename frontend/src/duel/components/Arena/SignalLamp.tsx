import { slots } from '@/duel/domain/duel'
import type { ArenaPhase, Fighter } from '@/duel/domain/fighter'
import { LABEL_MONO } from './label'

/* 신호등과 명판 — 탄피(Shell)·경고등(Warn)은 컨트롤러(ControllerParts)도 쓴다. */

export function SignalLamp({ phase, round }: { phase: ArenaPhase; round: number }) {
  const green = phase === 'signal'
  const dim = phase === 'result'
  const glow = green ? '#4ade80' : dim ? '#5b2323' : '#ef4444'

  return (
    <div
      className={`pointer-events-none absolute left-1/2 flex flex-col items-center ${
        phase === 'waiting' ? 'animate-duel-sway' : ''
      }`}
      style={{ top: 0, transform: 'translateX(-50%)', transformOrigin: '50% 0%' }}
    >
      <div
        style={{
          background: 'linear-gradient(#8a6a4a, #4b3524)',
          height: 'clamp(12px, 3vh, 28px)',
          width: 3,
        }}
      />
      <div
        style={{
          border: '2.5px solid #6b4f36',
          borderBottom: 'none',
          borderRadius: 999,
          height: 8,
          marginBottom: -2,
          width: 14,
        }}
      />
      <div
        className={green ? 'animate-duel-lamp-pop' : ''}
        key={green ? 'green' : dim ? 'dim' : 'red'}
        style={{
          aspectRatio: '1',
          background: green
            ? 'radial-gradient(circle at 40% 34%, #ffffff 0%, #86efac 30%, #22c55e 62%, #14532d 100%)'
            : dim
              ? 'radial-gradient(circle at 40% 34%, #6b3030 0%, #3d1a1a 60%, #180a0a 100%)'
              : 'radial-gradient(circle at 40% 34%, #ffd0d0 0%, #ef4444 32%, #b91c1c 64%, #450a0a 100%)',
          border: '3px solid #2a1a12',
          borderRadius: 999,
          boxShadow: `0 0 ${green ? 48 : 24}px ${glow}, inset 0 0 14px rgb(0 0 0 / 45%)`,
          position: 'relative',
          width: 'clamp(50px, 11vh, 76px)',
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, transparent 46%, rgb(20 10 8 / 70%) 46%, rgb(20 10 8 / 70%) 54%, transparent 54%)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(0deg, transparent 46%, rgb(20 10 8 / 50%) 46%, rgb(20 10 8 / 50%) 54%, transparent 54%)',
          }}
        />
      </div>
      <div
        className={`mt-1.5 rounded-xs px-3 py-0.5 ${LABEL_MONO}`}
        style={{
          background: 'linear-gradient(#6b4429, #472c1a)',
          border: '1px solid #2a1a10',
          boxShadow: '0 2px 6px rgb(0 0 0 / 50%)',
          color: '#f0d8b0',
          fontSize: 10,
        }}
      >
        ROUND {round}
      </div>
    </div>
  )
}

export function Plate({
  align,
  fighter,
  maxFouls,
  maxHp,
}: {
  align: 'left' | 'right'
  fighter: Fighter
  maxFouls: number
  maxHp: number
}) {
  const dead = fighter.hp <= 0
  return (
    <div className={`flex flex-col ${align === 'right' ? 'items-end' : 'items-start'} gap-1`}>
      <div
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        style={{
          background: 'rgb(12 4 8 / 60%)',
          border: `1px solid ${fighter.outfit.scarf}66`,
        }}
      >
        <span
          className="size-2 rounded-full"
          style={{ background: fighter.outfit.scarf, opacity: dead ? 0.3 : 1 }}
        />
        <span
          className="text-xs font-black tracking-wide whitespace-nowrap"
          style={{ color: dead ? 'rgb(255 255 255 / 35%)' : 'var(--ds-duel-ink)' }}
        >
          {fighter.name}
        </span>
        <span className="flex items-center gap-1">
          {slots('warn', maxFouls, fighter.fouls).map((slot) => (
            <Warn key={slot.id} lit={slot.filled} />
          ))}
        </span>
      </div>

      <div className={`flex gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {slots('shell', maxHp, fighter.hp).map((slot) => (
          <Shell key={slot.id} live={slot.filled} />
        ))}
      </div>
    </div>
  )
}

export function Warn({ lit }: { lit: boolean }) {
  return (
    <span
      className="block"
      style={{
        borderBottom: `8px solid ${lit ? 'var(--ds-duel-gold)' : 'rgb(255 255 255 / 20%)'}`,
        borderLeft: '4.5px solid transparent',
        borderRight: '4.5px solid transparent',
        filter: lit ? 'drop-shadow(0 0 4px rgb(251 191 36 / 90%))' : undefined,
        height: 0,
        width: 0,
      }}
    />
  )
}

export function Shell({ live }: { live: boolean }) {
  return (
    <span
      className="block"
      style={{
        background: live
          ? 'linear-gradient(#ffe9a8 0%, #d9a53c 34%, #8a5f18 100%)'
          : 'linear-gradient(rgb(255 255 255 / 10%), rgb(255 255 255 / 4%))',
        border: live ? '1px solid #6d4a11' : '1px solid rgb(255 255 255 / 18%)',
        borderRadius: '2px 2px 3px 3px',
        boxShadow: live ? '0 0 6px rgb(217 165 60 / 50%)' : 'none',
        height: 15,
        width: 8,
      }}
    />
  )
}
