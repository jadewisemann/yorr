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

  const liveCount = games.filter((game) => game.live).length

  return (
    // 디자인 11 GAMES 사이드 패널 — 번호·이름·메타·상태 배지를 행으로 눕힌다.
    <div className="flex min-w-[min(320px,34vw)] flex-none flex-col gap-3 rounded-[18px] bg-landing-panel p-4 shadow-landing-panel">
      <div className="flex items-baseline justify-between px-1">
        <span className="font-mono text-[11px] font-bold tracking-[0.16em] text-landing-text-muted uppercase">
          Games
        </span>
        <span className="text-[12px] text-landing-text-muted">
          {games.length}개 중 {liveCount}개 공개
        </span>
      </div>
      <div
        aria-label="게임 선택"
        aria-orientation="vertical"
        className="flex flex-col items-stretch gap-2"
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
                'flex w-full cursor-pointer items-center gap-3.5 rounded-[16px] border p-3.5 text-left transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
                selected
                  ? 'border-white/22 bg-landing-soft-strong shadow-[0_0_0_3px_rgb(255_255_255_/_4%)]'
                  : 'border-landing-hairline bg-transparent hover:bg-landing-veil',
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
                className={cn(
                  'w-6 flex-none font-mono text-[14px]/none font-bold tabular-nums',
                  selected || game.live ? 'text-landing-text' : 'text-landing-text-faint',
                )}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-[5px]">
                <span
                  className={cn(
                    'whitespace-nowrap tracking-[-0.02em]',
                    selected
                      ? 'text-[17px]/[1.1] font-bold text-landing-text'
                      : 'text-[16px]/[1.1] font-landing-bold text-landing-text-tertiary',
                  )}
                >
                  {game.name}
                </span>
                <span className="text-[12px]/none font-semibold tracking-[0.02em] text-landing-text-muted">
                  {gameMeta(game)}
                </span>
              </span>
              <span
                className={cn(
                  'inline-flex h-7 flex-none items-center gap-1.5 rounded-[8px] border px-2.5 text-[11.5px] font-bold whitespace-nowrap',
                  game.live
                    ? 'border-positive/40 bg-positive/14 text-positive'
                    : 'border-landing-hairline bg-landing-soft text-landing-text-muted',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-[7px] bg-current',
                    game.live ? 'rounded-full' : 'rounded-[2px]',
                  )}
                />
                {game.live ? '플레이 가능' : '공개 예정'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
