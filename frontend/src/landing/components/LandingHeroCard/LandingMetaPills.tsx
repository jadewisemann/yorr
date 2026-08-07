import type { Game } from '@/games'
import { cn } from '@/shared/cn'

interface LandingMetaPillsProps {
  game: Game
  layout: 'narrow' | 'wide'
}

const metaPillSize = {
  narrow: 'h-7.5 px-1.5 text-2xs',
  wide: 'h-8.5 px-3 text-xs',
} as const

const metaBadgeSize = {
  narrow: 'text-2xs',
  wide: 'text-xs',
} as const

export function LandingMetaPills({ game, layout }: LandingMetaPillsProps) {
  const pillBase = cn(
    'inline-flex flex-none items-center rounded-full border whitespace-nowrap',
    metaPillSize[layout],
  )

  return (
    <>
      <span
        className={cn(
          pillBase,
          'font-mono font-bold tracking-[0.12em]',
          metaBadgeSize[layout],
          game.live
            ? 'border-landing-accent/45 bg-landing-accent-tint text-landing-accent-text'
            : 'border-landing-hairline-strong bg-landing-well text-landing-text-strong',
        )}
      >
        {game.players}
      </span>
      {[game.duration, game.control].map((label) => (
        <span
          className={cn(
            pillBase,
            'border-landing-hairline-strong bg-landing-well font-semibold text-landing-text-strong',
          )}
          key={label}
        >
          {label}
        </span>
      ))}
    </>
  )
}
