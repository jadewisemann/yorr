import { cn } from '@/shared/cn'
import type { LandingHeroCardProps } from './types'

const playCta =
  'flex cursor-pointer items-center justify-center gap-3.5 rounded-panel border-0 bg-landing-accent font-bold text-landing-accent-ink transition-[color,background-color,border-color,scale] duration-150 ease-out focus-visible:outline-3 focus-visible:outline-white focus-visible:outline-offset-3 active:scale-[0.97]'

const lockedCta =
  'flex cursor-not-allowed items-center justify-center gap-3.5 rounded-panel border border-landing-hairline-strong bg-landing-disabled font-bold text-landing-text-faint'

const playCtaSize = {
  narrow: 'h-15 w-full text-lg shadow-landing-cta-sheet',
  wide: 'h-18 shrink-0 px-13 text-2xl shadow-landing-cta',
} as const

const lockedCtaSize = {
  narrow: 'h-15 w-full text-lg',
  wide: 'h-18 shrink-0 px-14 text-xl',
} as const

export function HeroCta({ game, layout, onPlay }: LandingHeroCardProps) {
  if (!game.live) {
    return (
      <button
        aria-label="준비 중인 게임"
        className={cn(lockedCta, lockedCtaSize[layout])}
        disabled
        type="button"
      >
        <span aria-hidden="true" className="size-2.5 rounded-xs bg-current" />
        준비 중
      </button>
    )
  }

  return (
    <button
      aria-label={`${game.name} 플레이`}
      className={cn(playCta, playCtaSize[layout])}
      onClick={onPlay}
      type="button"
    >
      <PlayGlyph />
      플레이
    </button>
  )
}

function PlayGlyph() {
  return (
    <span
      aria-hidden="true"
      className="size-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-current"
    />
  )
}
