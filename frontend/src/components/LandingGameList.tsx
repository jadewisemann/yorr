import { type KeyboardEvent, useRef } from 'react'
import { cn } from '@/cn'
import { gameMeta, LANDING_PANEL_ID, type LandingGame, landingTabId } from '@/landingGames'
import { resolveTablistKey } from '@/tablistNavigation'

interface LandingGameListProps {
  activeIndex: number
  games: LandingGame[]
  onSelect: (index: number) => void
}

/**
 * 데스크톱 히어로의 세로 게임 목록. 3D 캔버스 위에 얹히므로 목록 자체가 불투명 패널을 갖는다
 * — 텍스트가 캔버스에 직접 놓이면 대비를 보장할 수 없다.
 */
export function LandingGameList({ activeIndex, games, onSelect }: LandingGameListProps) {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = resolveTablistKey(event.key, activeIndex, games.length)
    if (next === null) return
    event.preventDefault()
    onSelect(next)
    // 포커스가 tabindex="-1" 탭에 남지 않도록 새로 선택된 탭으로 옮긴다.
    tabsRef.current[next]?.focus({ preventScroll: true })
  }

  return (
    <div
      aria-label="게임 선택"
      aria-orientation="vertical"
      className="flex min-w-[min(300px,34vw)] flex-none flex-col items-stretch gap-0.5 rounded-[18px] bg-landing-panel p-2 shadow-landing-panel"
      onKeyDown={handleKeyDown}
      role="tablist"
    >
      {games.map((game, index) => {
        const selected = index === activeIndex
        return (
          <button
            aria-controls={LANDING_PANEL_ID}
            aria-selected={selected}
            id={landingTabId(game.key)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-3.5 rounded-[14px] border-0 py-[13px] pr-4 pl-3 text-left transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
              selected ? 'bg-landing-accent-tint' : 'bg-transparent hover:bg-landing-veil',
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
                'block w-[3px] flex-none rounded-full transition-[height,background-color] duration-200 ease-out',
                selected ? 'h-[34px] bg-landing-accent' : 'h-[18px] bg-landing-bar',
              )}
            />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-[3px]">
              <span
                className={cn(
                  'whitespace-nowrap tracking-[-0.02em]',
                  selected
                    ? 'text-[20px]/[1.1] font-bold text-landing-text'
                    : 'text-[16px]/[1.1] font-landing-bold text-landing-text-tertiary',
                )}
              >
                {game.name}
              </span>
              <span
                className={cn(
                  'text-[11.5px]/none font-semibold tracking-[0.03em]',
                  selected ? 'text-landing-accent-text' : 'text-landing-text-muted',
                )}
              >
                {gameMeta(game)}
                {game.live ? '' : ' · 공개 예정'}
              </span>
            </span>
            <span
              className={cn(
                'font-mono text-[11px]/none font-landing-bold tracking-[0.06em]',
                selected ? 'text-landing-accent' : 'text-landing-text-faint',
              )}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
