import { Shell, Warn } from '@/duel/components/Arena'
import { DRAW_PENALTY_MS, MAX_FOULS, MAX_HP, msLabel, slots } from '@/duel/domain/duel'
import type { SwingPermission } from '@/shared/useSwing'

/**
 * 파티 모드 폰 화면 — 손 안의 리볼버. (S15P11A406-207)
 *
 * 결투는 큰 화면에서 벌어진다. 두 총잡이·총알·석양은 TV가 그리고, 폰은 <b>뽑는 일</b>만 한다.
 * 그래서 여기에 무대(Arena)를 축소해 넣지 않는다 — 같은 것을 두 화면에 그리면 폰을 보는
 * 동안 TV의 연출을 놓치고, 세로 그립에 억지로 접어 넣은 무대는 둘 다 못 읽는 화면이 된다.
 *
 * 대신 아래를 <b>보지 않고도</b> 알아야 하는 것만 남긴다: 신호가 초록인가, 내 탄약이 몇 발
 * 남았나, 경고가 몇 개 쌓였나. 판정은 서버가 하고 이 화면은 상태를 읽기만 한다.
 */

/** 신호등이 지금 무슨 색인가 — 폰이 아는 것은 이 넷뿐이다. */
type ControllerSignal = 'hold' | 'draw' | 'result' | 'waiting'

/**
 * 큰 신호등. 무대의 SignalLamp와 달리 매달린 줄도 간판도 없다 — 폰에서는 이것이 화면의
 * 중심이고, 초록인지 아닌지가 한 번의 눈길로 읽혀야 한다.
 */
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

/**
 * 무엇으로 뽑고 있는지, 그게 불리한지.
 *
 * 페널티를 숨기지 않는다 — 왜 계속 지는지 모르는 것보다 "화면 탭은 스윙보다 100ms 느리게
 * 기록된다"고 알고 지는 편이 낫다. 알면 폰을 휘두르러 간다.
 */
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

/** 이름 + 남은 탄약 + 경고. 무대의 Plate와 같은 칸을 쓰되 세로 그립에 맞춰 접었다. */
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
      {/* 자리는 늘 잡아 둔다 — 기록이 뜰 때마다 위 칸이 밀려 올라가면 눈이 따라가지 못한다. */}
      <span className="min-h-4 font-mono text-2xs text-game-content-faint">
        {showMs && ms !== null ? msLabel(ms) : null}
      </span>
    </div>
  )
}
