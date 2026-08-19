/* 한 발의 연출 — 도발 말풍선, 착탄 섬광, 탄도, 격돌. 전부 fxKey로 리마운트된다. */

export function Taunt({ delayMs, side, taunt }: { delayMs: number; side: 1 | 2; taunt: string }) {
  const left = side === 1
  return (
    <div
      className="animate-duel-slam pointer-events-none absolute"
      style={{
        [left ? 'left' : 'right']: '17%',
        animationDelay: `${delayMs}ms`,
        bottom: 'calc(28% + var(--gs-h) * 1.02)',
        transform: `translateX(${left ? '-50%' : '50%'})`,
      }}
    >
      <span
        className="block rounded-control px-3 py-1.5 text-xs leading-tight font-black whitespace-nowrap"
        style={{
          background: 'linear-gradient(#fff6df, #f0dcb0)',
          border: '2px solid #8a6a3a',
          boxShadow: '0 6px 16px rgb(0 0 0 / 45%)',
          color: '#3a2410',
        }}
      >
        {taunt}
      </span>
      <span
        className="absolute block"
        style={{
          [left ? 'left' : 'right']: 14,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderTop: '9px solid #8a6a3a',
          bottom: -9,
          height: 0,
          width: 0,
        }}
      />
    </div>
  )
}

export function ImpactFlash({ delayMs, winner }: { delayMs: number; winner: 0 | 1 | 2 }) {
  return (
    <div
      className="animate-duel-impact pointer-events-none absolute"
      style={{
        [winner === 1 ? 'right' : 'left']: '17%',
        animationDelay: `${delayMs}ms`,
        aspectRatio: '1',
        background:
          'radial-gradient(circle, #fff 0%, #ffd9a0 26%, rgb(239 68 68 / 85%) 52%, rgb(239 68 68 / 0%) 72%)',
        borderRadius: 999,
        bottom: 'calc(28% + var(--gs-h) * 0.4)',
        transform: `translateX(${winner === 1 ? '50%' : '-50%'})`,
        width: 'calc(var(--gs-h) * 0.52)',
      }}
    />
  )
}

export function Bullet({
  clash = false,
  color,
  dir,
  flightMs,
  miss = false,
}: {
  clash?: boolean
  color: string
  dir: 'r' | 'l'
  flightMs: number
  miss?: boolean
}) {
  const away = dir === 'r' ? 1 : -1
  return (
    <div
      className={clash ? 'animate-duel-bullet-clash' : 'animate-duel-bullet'}
      style={{
        animationDuration: `${clash ? Math.round(flightMs / 2) : flightMs}ms`,
        ['--duel-bullet-rise' as string]: miss ? '-26px' : '0px',
        ['--duel-bullet-to' as string]: `${away * (clash ? 50 : 100)}%`,
        inset: 0,
        position: 'absolute',
      }}
    >
      <div
        style={{
          [dir === 'r' ? 'left' : 'right']: 0,
          background:
            dir === 'r'
              ? `linear-gradient(90deg, rgb(255 255 255 / 0%) 0%, ${color}99 60%, #fff 100%)`
              : `linear-gradient(90deg, #fff 0%, ${color}99 40%, rgb(255 255 255 / 0%) 100%)`,
          borderRadius: 999,
          boxShadow: `0 0 10px ${color}, 0 0 20px ${color}66`,
          height: 4,
          position: 'absolute',
          top: -2,
          width: 'clamp(30px, 7vw, 52px)',
        }}
      />
    </div>
  )
}

export function Clash({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="animate-duel-clash absolute"
      style={{
        animationDelay: `${delayMs}ms`,
        aspectRatio: '1',
        background:
          'radial-gradient(circle, #ffffff 0%, #fff1b8 24%, rgb(251 191 36 / 80%) 46%, rgb(251 191 36 / 0%) 70%)',
        borderRadius: 999,
        left: '50%',
        top: 0,
        width: 'clamp(52px, 13vw, 96px)',
      }}
    />
  )
}

export function FoulDust({
  delayMs,
  selfShot,
  side,
}: {
  delayMs: number
  selfShot: boolean
  side: 1 | 2
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        [side === 1 ? 'left' : 'right']: '17%',
        bottom: '28%',
        transform: `translateX(${side === 1 ? '-50%' : '50%'})`,
      }}
    >
      <div
        className="animate-duel-dust absolute"
        style={{
          animationDelay: `${delayMs}ms`,
          aspectRatio: '1',
          background: selfShot
            ? 'radial-gradient(circle, #fff 0%, #ffd0a0 22%, rgb(239 68 68 / 80%) 48%, rgb(120 53 15 / 0%) 72%)'
            : 'radial-gradient(circle, #ffe9c2 0%, rgb(214 150 90 / 70%) 34%, rgb(120 80 40 / 0%) 70%)',
          borderRadius: 999,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: selfShot ? 'calc(var(--gs-h) * 0.62)' : 'calc(var(--gs-h) * 0.44)',
        }}
      />
    </div>
  )
}
