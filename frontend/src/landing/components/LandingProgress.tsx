import { type KeyboardEvent, useRef } from 'react'
import type { Game } from '@/games'
import { gameMeta, LANDING_PANEL_ID, landingTabId } from '@/landing/landingTabs'
import { cn } from '@/shared/cn'
import { resolveRovingKey } from '@/shared/rovingFocus'

interface LandingProgressProps {
  activeIndex: number
  games: Game[]
  layout: 'narrow' | 'wide'
  onSelect: (index: number) => void
}

export function LandingProgress({ activeIndex, games, layout, onSelect }: LandingProgressProps) {
  const wide = layout === 'wide'
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = resolveRovingKey(event.key, activeIndex, games.length)
    if (next === null) return
    event.preventDefault()
    onSelect(next)
    tabsRef.current[next]?.focus({ preventScroll: true })
  }

  return (
    <div className={cn('flex items-center', wide ? 'justify-center gap-6' : 'w-full gap-3')}>
      <span
        className={cn(
          'flex-none font-mono font-bold tracking-[0.08em] tabular-nums',
          wide ? 'text-base' : 'text-sm',
        )}
      >
        <span className="text-landing-text">{String(activeIndex + 1).padStart(2, '0')}</span>
        <span className="text-landing-text-muted">
          {' / '}
          {String(games.length).padStart(2, '0')}
        </span>
      </span>

      <div
        aria-label="게임 선택"
        aria-orientation="horizontal"
        className="flex flex-none items-center"
        onKeyDown={handleKeyDown}
        role="tablist"
      >
        {games.map((game, index) => {
          const selected = index === activeIndex
          return (
            <button
              aria-controls={LANDING_PANEL_ID}
              aria-label={`${game.name}, ${gameMeta(game)}${game.live ? '' : ', 준비 중'}`}
              aria-selected={selected}
              id={landingTabId(game.key)}
              className={cn(
                'grid min-h-tap cursor-pointer place-items-center border-0 bg-transparent focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-1 pressable',
                wide ? 'px-1.5' : 'px-1',
              )}
              key={game.key}
              onClick={() => onSelect(index)}
              ref={(element) => {
                tabsRef.current[index] = element
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'block h-1 rounded-full transition-[width,background-color] duration-(--ds-motion-base) ease-snappy',
                  selected
                    ? cn('bg-landing-accent', wide ? 'w-12' : 'w-8.5')
                    : cn('bg-landing-bar', wide ? 'w-2' : 'w-[7px]'),
                )}
              />
            </button>
          )
        })}
      </div>

      {wide ? (
        <>
          <span aria-hidden="true" className="h-4 w-px flex-none bg-landing-hairline-strong" />
          <span className="flex-none font-mono text-xs font-semibold tracking-[0.18em] text-landing-text-muted">
            DRAG OR USE ← →
          </span>
        </>
      ) : (
        <span className="flex-1 text-right text-xs text-landing-text-muted max-tiny:hidden">
          옆으로 밀어 다른 게임 보기
        </span>
      )}
    </div>
  )
}
