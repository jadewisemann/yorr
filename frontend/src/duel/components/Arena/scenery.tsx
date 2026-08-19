import type { ArenaPhase } from '@/duel/domain/fighter'

/*
 * 황무지 배경 — 하늘·땅·해 그라디언트와 소품(선인장·울타리·회전초).
 * Arena.tsx가 915줄이라 표시용 조각을 성격별로 갈랐다(2026-08-18, DESIGN 원칙 7).
 * 그라디언트 hex는 결투 세계관 팔레트라 토큰을 안 탄다 — 테마와 무관한 고정 무대다.
 */

function sky(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'linear-gradient(#02130d 0%, #0b3a25 32%, #17794a 60%, #35c06a 82%, #a7f3c4 100%)'
  if (phase === 'result')
    return 'linear-gradient(#14060f 0%, #33101f 34%, #6d2422 62%, #a94a26 84%, #cf8236 100%)'
  return 'linear-gradient(#1a0a18 0%, #431330 34%, #8d2f2c 62%, #d4622c 84%, #f5a944 100%)'
}

function ground(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'linear-gradient(#33955a 0%, #145030 26%, #071c13 70%, #030b08 100%)'
  if (phase === 'result')
    return 'linear-gradient(#8a4526 0%, #4a2016 26%, #1a0a0b 70%, #0a0405 100%)'
  return 'linear-gradient(#a35a2c 0%, #5d2a19 26%, #210d0d 70%, #0c0506 100%)'
}

function sun(phase: ArenaPhase): string {
  if (phase === 'signal')
    return 'radial-gradient(circle, #f0fff5 0%, #86efac 38%, #34d399 66%, rgb(16 185 129 / 0%) 72%)'
  return 'radial-gradient(circle, #fff3cd 0%, #ffcf72 34%, #ff9a3c 60%, rgb(232 83 42 / 0%) 72%)'
}

export function Wasteland({ phase }: { phase: ArenaPhase }) {
  const green = phase === 'signal'
  return (
    <>
      <div className="absolute inset-x-0 top-0" style={{ background: sky(phase), height: '72%' }} />

      <div
        className="absolute rounded-full"
        style={{
          aspectRatio: '1',
          background: green
            ? 'radial-gradient(circle, rgb(52 211 153 / 36%) 0%, rgb(52 211 153 / 0%) 60%)'
            : 'radial-gradient(circle, rgb(255 138 60 / 34%) 0%, rgb(255 90 40 / 0%) 60%)',
          left: '50%',
          top: '72%',
          transform: 'translate(-50%,-50%)',
          width: '124vmin',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          aspectRatio: '1',
          background: sun(phase),
          left: '50%',
          top: '72%',
          transform: 'translate(-50%,-50%)',
          width: 'clamp(150px, 42vmin, 330px)',
        }}
      />

      <svg
        aria-hidden="true"
        className="absolute inset-x-0"
        preserveAspectRatio="none"
        style={{ height: '29%', top: '43%' }}
        viewBox="0 0 400 100"
      >
        <polygon
          fill={green ? '#0c3f28' : '#40152a'}
          opacity="0.9"
          points="0,100 0,70 30,66 44,44 84,44 96,64 132,66 152,26 198,26 210,54 252,58 272,34 306,34 322,60 356,56 376,70 400,66 400,100"
        />
      </svg>
      <svg
        aria-hidden="true"
        className="absolute inset-x-0"
        preserveAspectRatio="none"
        style={{ height: '10.5%', top: '62%' }}
        viewBox="0 0 400 40"
      >
        <polygon
          fill={green ? '#04251a' : '#26091a'}
          points="0,40 0,27 42,20 92,25 142,14 202,19 252,12 312,21 360,16 400,23 400,40"
        />
      </svg>

      <div
        className="absolute inset-x-0"
        style={{
          background: green
            ? 'linear-gradient(rgb(167 243 196 / 0%), rgb(167 243 196 / 50%), rgb(167 243 196 / 0%))'
            : 'linear-gradient(rgb(255 196 120 / 0%), rgb(255 196 120 / 55%), rgb(255 196 120 / 0%))',
          filter: 'blur(7px)',
          height: '7%',
          top: '69%',
        }}
      />

      <div
        className="absolute inset-x-0 bottom-0"
        style={{ background: ground(phase), height: '28%' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 opacity-25"
        style={{
          background:
            'repeating-linear-gradient(94deg, rgb(0 0 0 / 35%) 0 2px, rgb(0 0 0 / 0%) 2px 22px)',
          height: '28%',
        }}
      />

      <div
        className="absolute"
        style={{ bottom: '25%', height: 'calc(var(--gs-h) * 0.6)', left: '2%' }}
      >
        <Cactus green={green} />
      </div>
      <div
        className="absolute"
        style={{ bottom: '26.5%', height: 'calc(var(--gs-h) * 0.42)', right: '3%' }}
      >
        <Cactus green={green} />
      </div>
      <div
        className="absolute"
        style={{ bottom: '27.4%', height: 'calc(var(--gs-h) * 0.2)', left: '35%' }}
      >
        <Fence green={green} />
      </div>
      {phase === 'waiting' && (
        <div
          className="animate-duel-tumble absolute"
          style={{ bottom: '18%', height: 'calc(var(--gs-h) * 0.15)' }}
        >
          <Tumbleweed />
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 52%, transparent 38%, rgb(6 2 4 / 74%) 100%)',
        }}
      />
    </>
  )
}

function Cactus({ green }: { green: boolean }) {
  const color = green ? '#04251a' : '#22071a'
  return (
    <svg aria-hidden="true" height="100%" viewBox="0 0 40 80">
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 79 L20 10" strokeWidth="10" />
        <path d="M20 42 L11 42 L11 24" strokeWidth="7" />
        <path d="M20 54 L30 54 L30 34" strokeWidth="7" />
      </g>
    </svg>
  )
}

function Fence({ green }: { green: boolean }) {
  const color = green ? '#04251a' : '#1e0616'
  return (
    <svg aria-hidden="true" height="100%" viewBox="0 0 90 40">
      <g fill={color}>
        <rect height="36" width="6" x="4" y="4" />
        <rect height="40" width="6" x="42" y="0" />
        <rect height="34" width="6" x="80" y="6" />
      </g>
      <g fill="none" stroke={color} strokeWidth="2.5">
        <path d="M6 14 L45 10 L83 16" />
        <path d="M6 26 L45 22 L83 28" />
      </g>
    </svg>
  )
}

function Tumbleweed() {
  return (
    <svg
      aria-hidden="true"
      className="animate-duel-roll"
      height="100%"
      style={{ transformOrigin: '50% 50%' }}
      viewBox="0 0 40 40"
    >
      <g fill="none" stroke="#2a0d18" strokeLinecap="round" strokeWidth="2.5">
        <circle cx="20" cy="20" r="16" />
        <path d="M6 12 L34 26 M6 28 L34 14 M20 4 L20 36 M4 20 L36 20" />
      </g>
    </svg>
  )
}
