import { AnimatePresence } from 'motion/react'
import { cn } from '@/shared/cn'
import { FullRanking } from './FullRanking'
import {
  Chevron,
  EmptyNotice,
  EntryRow,
  RankingPanel,
  ScrollingTrack,
  TickerLabel,
  TickerViewport,
} from './parts'
import { type BandProps, MIN_SCROLL_ENTRIES, PANEL_ID, useBandDisclosure } from './shared'

export function NarrowBand({ band, entries, loading, myNickname, myRank, myUserId }: BandProps) {
  const { open, setOpen } = useBandDisclosure(entries.length)

  return (
    <div className="relative flex h-11 items-center gap-3 px-5">
      <TickerLabel />
      <TickerViewport>
        {band.length === 0 ? (
          <EmptyNotice loading={loading} />
        ) : band.length >= MIN_SCROLL_ENTRIES ? (
          <ScrollingTrack entries={band} myUserId={myUserId} />
        ) : (
          <EntryRow entries={band} myUserId={myUserId} />
        )}
      </TickerViewport>

      {entries.length > 0 && (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'flex flex-none items-center',
              open ? 'text-landing-accent-text' : 'text-landing-text-muted',
            )}
          >
            <Chevron open={open} />
          </span>

          {/* 띠 전체가 탭 영역이다 — 목록(ol)은 button 안에 들어갈 수 없어 위에 덮는다. */}
          <button
            aria-controls={PANEL_ID}
            aria-expanded={open}
            aria-label="이번 주 요트랭킹 전체 보기"
            className="absolute inset-0 cursor-pointer border-0 bg-transparent focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:-outline-offset-3"
            onClick={() => setOpen((previous) => !previous)}
            type="button"
          />
        </>
      )}

      <AnimatePresence>
        {open && (
          <RankingPanel
            className="inset-x-3 top-full mt-2 max-h-[60svh] overflow-y-auto overscroll-contain"
            onClose={() => setOpen(false)}
            transformOrigin="top center"
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
