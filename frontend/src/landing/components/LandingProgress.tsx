import { type KeyboardEvent, useRef } from 'react'
import type { Game } from '@/games'
import { gameMeta, LANDING_PANEL_ID, landingTabId } from '@/landing/landingTabs'
import { resolveTablistKey } from '@/landing/tablistNavigation'
import { cn } from '@/shared/cn'

interface LandingProgressProps {
  activeIndex: number
  games: Game[]
  /** wide = 데스크톱 캐러셀 아래 한 줄, narrow = 모바일 카드 아래 한 줄. */
  layout: 'narrow' | 'wide'
  onSelect: (index: number) => void
}

/**
 * 캐러셀 위치 표시줄 — 번호 · 진행 막대 · 조작 안내. 진행 막대가 곧 게임 선택 tablist다.
 * 캐러셀은 드래그·휠·화살표로만 움직이므로, 키보드와 스크린리더에는 이 목록이 유일한 진입점이다.
 */
export function LandingProgress({ activeIndex, games, layout, onSelect }: LandingProgressProps) {
  const wide = layout === 'wide'
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
    <div className={cn('flex items-center', wide ? 'justify-center gap-5.5' : 'w-full gap-3')}>
      <span
        className={cn(
          'flex-none font-mono font-bold tracking-[0.08em] tabular-nums',
          wide ? 'text-[16px]' : 'text-[14px]',
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
              // 4px 막대는 그대로면 누를 수 없다 — 막대는 안에 그리고 버튼이 여백을 갖는다.
              // 가로는 5칸이 카운터·힌트와 한 줄을 나눠 써서 44px까지 못 넓힌다(세로만 충족).
              className={cn(
                'grid min-h-tap cursor-pointer place-items-center border-0 bg-transparent focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-1',
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
                  // 선택 상태는 폭(7→34px)과 색이 이미 말한다 — 글로우는 중복이고,
                  // 화면에서 유일하게 빛나는 레드는 CTA여야 한다.
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
          <span className="flex-none font-mono text-[12px] font-semibold tracking-[0.18em] text-landing-text-muted">
            DRAG OR USE ← →
          </span>
        </>
      ) : (
        /* 360px 미만에서는 감춘다. 카운터(55px)와 tablist(102px)가 flex-none이라 힌트에
           99px만 남고 두 줄로 접히는데, 카운터 옆에서 오른쪽 정렬로 두 줄이 되면 안내가
           아니라 깨진 것으로 읽힌다. 스와이프는 카드 자체로 발견되고 위치는 tablist가
           계속 말하므로, 랜딩이 h-svh인 화면에서 한 층을 더 쓰는 것보다 낫다. */
        <span className="flex-1 text-right text-[12px] text-landing-text-muted max-tiny:hidden">
          옆으로 밀어 다른 게임 보기
        </span>
      )}
    </div>
  )
}
