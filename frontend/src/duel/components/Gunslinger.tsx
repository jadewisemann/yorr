import { type CSSProperties, useId } from 'react'
import type { Outfit, Pose } from '@/duel/domain/fighter'

const BODY_PIVOT = '58px 172px'
const HAT_PIVOT = '96px 168px'

function bodyMotion(pose: Pose): { className?: string; style?: CSSProperties } {
  if (pose === 'hit') {
    return { className: 'animate-duel-knockback', style: { transformOrigin: BODY_PIVOT } }
  }
  if (pose === 'dead') {
    return {
      className: 'animate-duel-fall',
      style: { transform: 'rotate(-78deg)', transformOrigin: BODY_PIVOT },
    }
  }
  return {}
}

const ARM: Record<Pose, [number, number]> = {
  ready: [12, 8],
  draw: [-72, -22],
  hit: [-138, 34],
  dead: [-28, 18],
}

interface GunslingerProps {
  pose: Pose
  outfit: Outfit
  flip?: boolean
  fired?: boolean
  height?: number | string
}

export function Gunslinger({
  pose,
  outfit,
  fired = false,
  flip = false,
  height = '100%',
}: GunslingerProps) {
  const [upperArm, foreArm] = ARM[pose]
  const armed = fired || pose === 'draw'
  const shooting = fired && pose === 'draw'
  const down = pose === 'dead'
  const transition =
    pose === 'hit' || down ? 'transform 260ms cubic-bezier(0.33, 1, 0.68, 1)' : undefined
  const gradientId = `duel-body-${useId().replace(/:/g, '')}`

  return (
    <svg
      aria-hidden="true"
      height={height}
      style={{ transform: flip ? 'scaleX(-1)' : undefined, overflow: 'visible' }}
      viewBox="0 0 120 180"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="var(--ds-duel-canvas)" />
          <stop offset="60%" stopColor="#1c0e17" />
          <stop offset="100%" stopColor="#3a1c22" />
        </linearGradient>
      </defs>

      <ellipse cx="58" cy="176" fill="rgb(20 4 8 / 55%)" rx={down ? 46 : 26} ry="5" />

      <g {...bodyMotion(pose)}>
        <Body gradientId={gradientId} hatless={down} outfit={outfit} />

        <g transform="translate(54 64)">
          <g style={{ transform: `rotate(${upperArm}deg)`, transformOrigin: '0 0', transition }}>
            <path d="M -5.5 -5 L 5.5 -5 L 4 25 L -4 25 Z" fill="#150a11" />
            <g transform="translate(0 25)">
              <g className={shooting ? 'animate-duel-recoil' : undefined}>
                <g
                  style={{ transform: `rotate(${foreArm}deg)`, transformOrigin: '0 0', transition }}
                >
                  <path d="M -4.2 0 L 4.2 0 L 3.2 21 L -3.2 21 Z" fill="#1c0e17" />
                  <circle cx="0" cy="23" fill="#241118" r="4.2" />
                  {armed ? <Revolver firing={shooting} flash={outfit.rim} /> : null}
                </g>
              </g>
            </g>
          </g>
        </g>

        {pose === 'ready' && (
          <g>
            <path d="M 46 104 L 58 104 L 56 122 L 47 121 Z" fill="#2b1410" />
            <path d="M 48 100 L 57 100 L 56.5 106 L 48.5 106 Z" fill="#3d1d16" />
            <path d="M 42 98 L 62 98 L 62 103 L 42 103 Z" fill="#33170f" />
          </g>
        )}
      </g>

      {down && (
        <g className="animate-duel-hatoff" style={{ transformOrigin: HAT_PIVOT }}>
          <ellipse cx="96" cy="171" fill="#150a11" rx="17" ry="4.5" />
          <path d="M 87 171 Q 96 158 105 171 Z" fill="#1e0f16" />
          <path
            d="M 87.5 168 Q 96 165 104.5 168 L 104 171 L 88 171 Z"
            fill={outfit.scarf}
            opacity="0.85"
          />
        </g>
      )}
    </svg>
  )
}

function Body({
  gradientId,
  hatless,
  outfit,
}: {
  gradientId: string
  hatless: boolean
  outfit: Outfit
}) {
  return (
    <g>
      <path
        className="animate-duel-coat"
        d="M 44 72 L 24 136 L 41 130 L 45 106 Z"
        fill="#100610"
        style={{ transformOrigin: '45px 74px' }}
      />

      <path d="M 50 100 L 63 100 L 53 168 L 38 168 Z" fill="#100710" />
      <path d="M 36 164 L 55 164 L 56 172 L 34 172 Z" fill="#0a0409" />
      <path d="M 61 100 L 74 100 L 89 168 L 74 168 Z" fill={`url(#${gradientId})`} />
      <path d="M 72 164 L 91 164 L 92 172 L 70 172 Z" fill="#0a0409" />

      <path d="M 43 96 L 79 96 L 80 104 L 42 104 Z" fill="#0d0509" />
      <rect fill={outfit.scarf} height="8" opacity="0.8" rx="1.5" width="8" x="57" y="96" />

      <path d="M 45 62 Q 60 52 76 62 L 80 98 L 42 98 Z" fill={`url(#${gradientId})`} />

      <path d="M 50 58 L 72 58 L 62 76 Z" fill={outfit.scarf} />
      <path d="M 62 76 L 56 74 L 58 66 Z" fill={outfit.scarf} opacity="0.7" />

      <rect fill="#150a11" height="10" width="12" x="55" y="48" />
      <circle cx="61" cy="45" fill="#1a0c13" r="10" />

      {!hatless && (
        <g>
          <ellipse cx="59" cy="38" fill="#150a11" rx="37" ry="6.5" transform="rotate(-3 59 38)" />
          <path d="M 43 38 L 46 17 Q 60 9 75 17 L 78 38 Z" fill="#1c0e17" />
          <path d="M 43.4 34 Q 60 30 77.6 34 L 78 38 L 43 38 Z" fill={outfit.scarf} opacity="0.9" />
          <path d="M 78 34 Q 92 36 96 38.5 Q 90 41 78 41.5 Z" fill={outfit.rim} opacity="0.35" />
        </g>
      )}

      <path d="M 76 62 L 80 98 L 80.5 104 L 74 100 L 74.5 64 Z" fill={outfit.rim} opacity="0.3" />
    </g>
  )
}

function Revolver({ firing, flash }: { firing: boolean; flash: string }) {
  return (
    <g>
      <path d="M -4.5 17 L 1.5 19 L 0.5 27 L -5.5 25 Z" fill="#2b1a14" />
      <rect fill="#3a3a44" height="8" rx="1.8" width="6.5" x="-3" y="22" />
      <rect fill="#4a4a56" height="14" rx="1.2" width="3.4" x="-1.6" y="29" />
      {firing && (
        <g className="animate-duel-muzzle" style={{ transformOrigin: '0px 43px' }}>
          <path d="M 0 60 L -7 45 L -2.5 43.5 L 0 30 L 2.5 43.5 L 7 45 Z" fill={flash} />
          <circle cx="0" cy="44" fill="#fff3d0" opacity="0.9" r="6.5" />
          <circle cx="0" cy="46" fill={flash} opacity="0.28" r="12" />
        </g>
      )}
    </g>
  )
}
