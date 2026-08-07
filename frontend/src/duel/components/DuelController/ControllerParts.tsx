import { Shell, Warn } from '@/duel/components/Arena'
import { DRAW_PENALTY_MS, MAX_FOULS, MAX_HP, msLabel, slots } from '@/duel/domain/duel'
import type { SwingPermission } from '@/shared/useSwing'

type ControllerSignal = 'hold' | 'draw' | 'result' | 'waiting'

export function Lamp({ signal }: { signal: ControllerSignal }) {
  const green = signal === 'draw'
  const dim = signal === 'result' || signal === 'waiting'
  const face = green ? '#22c55e' : dim ? '#3d1a1a' : '#ef4444'
  const glow = green ? '#4ade80' : dim ? '#5b2323' : '#ef4444'

  return (
    <span
      aria-hidden="true"
      className={`absolute top-[14%] left-1/2 block aspect-square -translate-x-1/2 rounded-full ${green ? 'animate-duel-lamp-pop' : ''}`}
      key={signal}
      style={{
        background: `radial-gradient(circle at 40% 34%, ${green ? '#ffffff' : dim ? '#6b3030' : '#ffd0d0'} 0%, ${face} 55%, #1a0a0a 100%)`,
        border: '4px solid #2a1a12',
        boxShadow: `0 0 ${green ? 56 : 24}px ${glow}, inset 0 0 16px rgb(0 0 0 / 45%)`,
        width: 'min(38vw, 150px)',
      }}
    />
  )
}

export function DrawSourceStatus({ permission }: { permission: SwingPermission }) {
  if (permission === 'granted') {
    return (
      <p className="m-0 text-sm font-bold text-duel-positive" role="status">
        스윙 연결됨 · 폰을 휘둘러 뽑는다
      </p>
    )
  }
  if (permission === 'unknown') return null
  return (
    <p className="m-0 text-sm text-amber-200" role="status">
      모션 센서를 쓸 수 없어 화면 탭으로 뽑는다 · 스윙보다 {DRAW_PENALTY_MS.tap}ms 느리게 기록된다
    </p>
  )
}

export function AmmoRow({
  fouls,
  hp,
  label,
  ms,
  showMs,
}: {
  fouls: number
  hp: number
  label: string
  ms: number | null
  showMs: boolean
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-xs font-black text-duel-ink">{label}</span>
        <span className="flex flex-none items-center gap-0.5">
          {slots('warn', MAX_FOULS, fouls).map((slot) => (
            <Warn key={slot.id} lit={slot.filled} />
          ))}
        </span>
      </span>
      <span className="flex gap-1">
        {slots('shell', MAX_HP, hp).map((slot) => (
          <Shell key={slot.id} live={slot.filled} />
        ))}
      </span>
      <span className="min-h-4 font-mono text-2xs text-game-content-faint">
        {showMs && ms !== null ? msLabel(ms) : null}
      </span>
    </div>
  )
}
