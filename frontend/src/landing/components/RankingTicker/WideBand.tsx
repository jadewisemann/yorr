import { AnimatePresence } from 'motion/react'
import { cn } from '@/shared/cn'
import { FullRanking } from './FullRanking'
import { Chevron, EmptyNotice, EntryRow, RankingPanel, TickerLabel, TickerViewport } from './parts'
import { type BandProps, PANEL_ID, useBandDisclosure } from './shared'

export function WideBand({ band, entries, loading, myNickname, myRank, myUserId }: BandProps) {
  const { open, setOpen } = useBandDisclosure(entries.length)
  const hidden = entries.length - band.length

  return (
    <div className="relative flex w-[69.4%] items-center gap-3">
      <TickerLabel />
      <TickerViewport>
        {band.length === 0 ? (
          <EmptyNotice loading={loading} />
        ) : (
          <EntryRow entries={band} myUserId={myUserId} />
        )}
      </TickerViewport>

      {entries.length > 0 && (
        <button
          aria-controls={PANEL_ID}
          aria-expanded={open}
          className={cn(
            'flex h-full flex-none cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-xs font-landing-bold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 pressable',
            open ? 'text-landing-accent-text' : 'text-landing-text-muted hover:text-landing-text',
          )}
          onClick={() => setOpen((previous) => !previous)}
          type="button"
        >
          {hidden > 0 ? `+${hidden}명 전체 보기` : '전체 보기'}
          <Chevron open={open} />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <RankingPanel
            className="top-full right-0 mt-2.5 w-90"
            onClose={() => setOpen(false)}
            transformOrigin="top right"
          >
            <FullRanking
              entries={entries}
              myNickname={myNickname}
              myRank={myRank}
              myUserId={myUserId}
            />
          </RankingPanel>
        )}
      </AnimatePresence>
    </div>
  )
}
