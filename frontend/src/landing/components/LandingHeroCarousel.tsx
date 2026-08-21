import { motion } from 'motion/react'
import { useEffect } from 'react'
import type { Game } from '@/games'
import { heroArtSrc } from '@/landing/components/HeroArt'
import { LANDING_PANEL_ID, landingTabId } from '@/landing/landingTabs'
import { useHeroCarousel } from '@/landing/model/useHeroCarousel'
import { cn } from '@/shared/cn'
import { LandingHeroCard } from './LandingHeroCard'

interface LandingHeroCarouselProps {
  activeIndex: number
  games: Game[]
  layout: 'narrow' | 'wide'
  onPlay: () => void
  onSelect: (index: number) => void
}

export function LandingHeroCarousel({
  activeIndex,
  games,
  layout,
  onPlay,
  onSelect,
}: LandingHeroCarouselProps) {
  const {
    game,
    handleClickCapture,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    next,
    nextIndex,
    previous,
    previousIndex,
    step,
    trackX,
    wide,
  } = useHeroCarousel({ activeIndex, games, layout, onSelect })

  /* 이웃 카드의 아트를 미리 받아 둔다 — 안 하면 스와이프 직후 새 src를 받는 동안
     카드가 한 박자 비어 보인다. 장당 수십 KB라 두 장 선로드가 손해가 아니다. */
  useEffect(() => {
    for (const neighbor of [previous, next]) {
      if (!neighbor) continue
      new Image().src = heroArtSrc(neighbor.key, layout)
    }
  }, [previous, next, layout])

  if (!game) return null

  return (
    <section
      aria-label="게임 캐러셀"
      className="relative h-full w-full touch-none select-none"
      onClickCapture={handleClickCapture}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <motion.div className="absolute inset-0" style={{ x: trackX }}>
        {previous && (
          <NeighborCard
            game={previous}
            layout={layout}
            onSelect={wide ? () => onSelect(previousIndex) : null}
            side="left"
          />
        )}
        {next && (
          <NeighborCard
            game={next}
            layout={layout}
            onSelect={wide ? () => onSelect(nextIndex) : null}
            side="right"
          />
        )}
        <div
          aria-labelledby={landingTabId(game.key)}
          className={cn(
            'absolute inset-y-0',
            wide ? 'left-1/2 w-[69.4%] -translate-x-1/2' : 'inset-x-5',
          )}
          id={LANDING_PANEL_ID}
          role="tabpanel"
        >
          <LandingHeroCard game={game} layout={layout} onPlay={onPlay} />

          <ArrowButton direction="previous" layout={layout} onClick={() => step(-1)} />
          <ArrowButton direction="next" layout={layout} onClick={() => step(1)} />
        </div>
      </motion.div>
    </section>
  )
}

function NeighborCard({
  game,
  layout,
  onSelect,
  side,
}: {
  game: Game
  layout: 'narrow' | 'wide'
  onSelect: (() => void) | null
  side: 'left' | 'right'
}) {
  const wide = layout === 'wide'
  const shell = cn(
    'absolute overflow-hidden border border-landing-hairline [background:var(--ds-landing-ghost)]',
    wide
      ? 'top-[7.2%] h-[85.6%] w-[13.5%] rounded-sheet'
      : 'pointer-events-none top-[6%] h-[88%] w-[24.6%] rounded-sheet opacity-40',
    wide
      ? side === 'left'
        ? 'left-0'
        : 'right-0'
      : side === 'left'
        ? 'left-[-15.6%]'
        : 'right-[-15.6%]',
  )

  if (!onSelect) return <div aria-hidden="true" className={shell} />

  return (
    <button
      aria-label={`${game.name} 선택`}
      className={cn(
        shell,
        'cursor-pointer p-0 opacity-65 transition-opacity duration-150 ease-out hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable',
      )}
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          'absolute inset-x-3.5 bottom-5 block text-balance text-left text-[clamp(13px,1.15vw,20px)]/[1.2] font-bold',
          game.live ? 'text-landing-text' : 'text-landing-text-muted',
        )}
      >
        {game.name}
      </span>
    </button>
  )
}

function ArrowButton({
  direction,
  layout,
  onClick,
}: {
  direction: 'next' | 'previous'
  layout: 'narrow' | 'wide'
  onClick: () => void
}) {
  const isNext = direction === 'next'
  const wide = layout === 'wide'

  return (
    <button
      aria-label={isNext ? '다음 게임' : '이전 게임'}
      className={cn(
        'absolute top-1/2 z-1 grid size-tap aspect-square -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-landing-text-muted transition-colors duration-150 ease-out hover:text-landing-text focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable',
        isNext ? (wide ? 'right-2' : 'right-0.5') : wide ? 'left-2' : 'left-0.5',
      )}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          'rotate-45 border-current',
          wide ? 'size-3.5 border-t-2 border-r-2' : 'size-3 border-t-2 border-r-2',
          isNext ? undefined : 'rotate-[225deg]',
        )}
      />
    </button>
  )
}
