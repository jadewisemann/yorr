import { HeroCta } from '@/landing/components/LandingHeroCard/HeroCta'
import { LandingMetaPills } from '@/landing/components/LandingHeroCard/LandingMetaPills'
import type { LandingHeroCardProps } from '@/landing/components/LandingHeroCard/types'
import { cn } from '@/shared/cn'
import { HeroArt } from './HeroArt'

export function LandingHeroCard({ game, layout, onPlay }: LandingHeroCardProps) {
  const wide = layout === 'wide'

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden border [background:var(--ds-landing-card)]',
        wide ? 'rounded-sheet' : 'rounded-sheet',
        game.live
          ? 'border-landing-accent/42 shadow-landing-card'
          : 'border-landing-hairline-strong shadow-landing-card-quiet',
      )}
    >
      <HeroArt game={game.key} layout={layout} />

      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 [background:var(--ds-landing-card-crown)]',
          cardCrown[layout],
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 [background:var(--ds-landing-card-glow)]',
          wide ? '-top-30 h-90 w-160' : '-top-17 h-55 w-75',
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 shadow-landing-card-inset"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 [background:var(--ds-landing-card-scrim)]',
          cardScrim[layout],
        )}
      />
      {game.live && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] [background:var(--ds-landing-accent-line)]"
        />
      )}

      <div
        className={cn(
          'absolute flex items-start justify-between',
          cardInsetX[layout],
          bandTop[layout],
          wide ? 'gap-6' : 'gap-4',
        )}
      >
        <div className="flex min-w-0 flex-col items-start gap-2">
          <h2
            className={cn(
              'm-0 text-balance font-bold tracking-[-0.035em] text-landing-text',
              wide ? 'text-[clamp(40px,4.6vw,66px)]/none' : 'text-[clamp(30px,9.4vw,38px)]/[1.05]',
            )}
          >
            {game.name}
          </h2>
          {!wide && (
            <p className="m-0 text-pretty text-sm/[1.35] font-semibold text-landing-text-strong [@media(max-height:600px)]:hidden">
              {game.tagline}
            </p>
          )}
        </div>

        {wide && (
          <div className="flex min-w-0 shrink-0 flex-nowrap justify-end gap-2">
            <LandingMetaPills game={game} layout="wide" />
          </div>
        )}
      </div>

      <div
        className={cn(
          'absolute flex',
          cardInsetX[layout],
          bandBottom[layout],
          wide ? 'items-end justify-between gap-6' : 'flex-col items-stretch gap-2',
        )}
      >
        {wide ? (
          <p className="m-0 line-clamp-2 min-w-0 text-pretty text-[clamp(16px,1.6vw,22px)]/[1.3] font-semibold text-landing-text-strong">
            {game.tagline}
          </p>
        ) : (
          <div className="flex min-w-0 flex-nowrap gap-1">
            <LandingMetaPills game={game} layout="narrow" />
          </div>
        )}
        <div className={cn('flex flex-none', wide ? 'justify-end' : 'items-stretch')}>
          <HeroCta game={game} layout={layout} onPlay={onPlay} />
        </div>
      </div>
    </div>
  )
}

const cardInsetX = {
  narrow: 'inset-x-5',
  wide: 'inset-x-9',
} as const

const bandTop = {
  narrow: 'top-[clamp(14px,4.7%,22px)]',
  wide: 'top-[clamp(18px,6.8%,36px)]',
} as const

const bandBottom = {
  narrow: 'bottom-[clamp(14px,4.7%,22px)]',
  wide: 'bottom-[clamp(18px,6.8%,36px)]',
} as const

const cardCrown = { narrow: 'h-[30%]', wide: 'h-[26%]' } as const

const cardScrim = { narrow: 'h-[28%]', wide: 'h-[26%]' } as const
