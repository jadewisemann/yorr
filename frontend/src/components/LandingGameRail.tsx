import { type KeyboardEvent, useRef } from 'react'
import { cn } from '@/cn'
import { gameMeta, LANDING_PANEL_ID, type LandingGame, landingTabId } from '@/landingGames'
import { resolveTablistKey } from '@/tablistNavigation'

interface LandingGameRailProps {
  activeIndex: number
  games: LandingGame[]
  onSelect: (index: number) => void
}

/** 선택된 칩이 레일 가장자리에 걸치지 않도록 남겨 두는 여백. */
const RAIL_INSET = 20

export function LandingGameRail({ activeIndex, games, onSelect }: LandingGameRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = resolveTablistKey(event.key, activeIndex, games.length)
    if (next === null) return
    event.preventDefault()
    onSelect(next)

    const tab = tabsRef.current[next]
    const rail = railRef.current
    if (!tab) return
    tab.focus({ preventScroll: true })
    if (!rail) return
    // scrollIntoView는 조상까지 스크롤시켜 시트 전체를 흔든다. 레일만 직접 민다.
    const left = tab.offsetLeft - RAIL_INSET
    const right = tab.offsetLeft + tab.offsetWidth + RAIL_INSET
    if (left < rail.scrollLeft) rail.scrollLeft = left
    else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = right - rail.clientWidth
  }

  return (
    <div
      aria-label="게임 선택"
      className="flex gap-2 overflow-x-auto px-5 py-0.5 [-ms-overflow-style:none] [scroll-snap-type:x_mandatory] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onKeyDown={handleKeyDown}
      ref={railRef}
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
              'h-11 flex-none cursor-pointer rounded-full border-0 px-[18px] text-[14px] font-landing-bold whitespace-nowrap transition-[background-color,color] duration-150 ease-out [scroll-snap-align:center] focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
              selected
                ? 'bg-landing-accent text-landing-accent-ink'
                : 'bg-landing-soft-strong text-landing-text-tertiary shadow-landing-chip',
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
            {game.name}
          </button>
        )
      })}
    </div>
  )
}
