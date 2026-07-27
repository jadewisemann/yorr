import { type KeyboardEvent, useId, useRef } from 'react'
import { cn } from '@/cn'
import type { CategoryScores, YachtCategory } from '@/domain/scoring'
import {
  UPPER_BONUS_THRESHOLD,
  YACHT_LOWER_CATEGORIES,
  YACHT_UPPER_CATEGORIES,
} from '@/domain/scoring'
import type { PlayerId } from '@/realtime/wsEvents'
import { resolveTablistKey } from '@/tablistNavigation'
import { categoryLabel, categoryRowState, isRecorded } from '@/yachtCategoryView'
import { ScoreRow } from './ScoreRow'

interface ScorePanelPlayer {
  nickname: string
  playerId: PlayerId
}

interface ScorePanelProps {
  candidates: CategoryScores
  className?: string
  onSelect: (category: YachtCategory) => void
  onViewPlayer: (playerId: PlayerId) => void
  players: ScorePanelPlayer[]
  recorded: Partial<Record<YachtCategory, number | null>>
  selectedCategory: YachtCategory | null
  total: number
  upperSubtotal: number
  viewedPlayerId: PlayerId
  you: PlayerId
}

/**
 * W② 웹 좌측 상시 패널. 모바일의 바텀시트를 대체한다 —
 * 시선 시작점에 상태를 두고 우측을 주사위·CTA에 온전히 내주기 위한 배치다.
 * 모바일 ⑥의 전체 매트릭스는 여기서 플레이어 세그먼트 전환으로 대신한다.
 */
export function ScorePanel({
  candidates,
  className,
  onSelect,
  onViewPlayer,
  players,
  recorded,
  selectedCategory,
  total,
  upperSubtotal,
  viewedPlayerId,
  you,
}: ScorePanelProps) {
  const mine = viewedPlayerId === you
  const panelId = useId()
  const tabIdPrefix = useId()
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const activeIndex = Math.max(
    0,
    players.findIndex((player) => player.playerId === viewedPlayerId),
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = resolveTablistKey(event.key, activeIndex, players.length)
    if (next === null) return
    event.preventDefault()
    const player = players[next]
    if (!player) return
    onViewPlayer(player.playerId)
    // 포커스가 tabindex="-1" 탭에 남지 않도록 새로 선택된 탭으로 옮긴다.
    tabsRef.current[next]?.focus({ preventScroll: true })
  }

  const renderRow = (category: YachtCategory) => {
    const recordedScore = recorded[category]
    return (
      <ScoreRow
        key={category}
        label={categoryLabel[category]}
        // 남의 점수표는 읽기 전용이다.
        {...(mine ? { onSelect: () => onSelect(category) } : {})}
        score={isRecorded(recordedScore) ? recordedScore : mine ? candidates[category] : undefined}
        size="sm"
        state={categoryRowState(recordedScore, mine && selectedCategory === category)}
      />
    )
  }

  return (
    <section
      aria-label="점수표"
      className={cn('flex min-h-0 flex-col border-r border-border bg-surface-sunken', className)}
    >
      <header className="flex-none border-b border-border px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="m-0 text-sm font-bold text-content">{mine ? '내 점수표' : '점수표'}</h2>
          <p className="m-0 text-[11px] text-content-muted">
            합계 <strong className="font-mono font-bold text-content tabular-nums">{total}</strong>
          </p>
        </div>
        {players.length > 1 && (
          <div
            aria-label="점수표를 볼 플레이어"
            className="mt-2.5 flex gap-1 overflow-x-auto rounded-control bg-surface p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onKeyDown={handleKeyDown}
            role="tablist"
          >
            {players.map((player, index) => {
              const selected = player.playerId === viewedPlayerId
              return (
                <button
                  aria-controls={panelId}
                  aria-selected={selected}
                  className={cn(
                    'min-w-0 flex-1 cursor-pointer truncate rounded-[0.375rem] border-0 px-2 py-1.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-[-2px]',
                    selected ? 'bg-brand text-on-brand' : 'bg-transparent text-content-muted',
                  )}
                  id={`${tabIdPrefix}-${player.playerId}`}
                  key={player.playerId}
                  onClick={() => onViewPlayer(player.playerId)}
                  ref={(element) => {
                    tabsRef.current[index] = element
                  }}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {player.playerId === you ? '나' : player.nickname}
                </button>
              )
            })}
          </div>
        )}
      </header>

      <div
        className="grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto px-3 py-2"
        id={panelId}
        {...(players.length > 1
          ? {
              'aria-labelledby': `${tabIdPrefix}-${viewedPlayerId}`,
              role: 'tabpanel' as const,
              tabIndex: 0,
            }
          : {})}
      >
        {YACHT_UPPER_CATEGORIES.map(renderRow)}
        <p className="m-0 flex items-center justify-between border-y border-border px-3 py-1.5 text-[10.5px] font-bold text-content-muted">
          상단 보너스
          <span className="font-mono tabular-nums">
            {upperSubtotal} / {UPPER_BONUS_THRESHOLD}
          </span>
        </p>
        {YACHT_LOWER_CATEGORIES.map(renderRow)}
      </div>
    </section>
  )
}
