import {
  EmptyNotice,
  EntryRow,
  ScrollingTrack,
  TickerLabel,
  TickerViewport,
} from '@/landing/components/RankingTicker/parts'
import { MIN_SCROLL_ENTRIES } from '@/landing/components/RankingTicker/shared'
import { WideBand } from '@/landing/components/RankingTicker/WideBand'
import { useMyWeeklyRank, useWeeklyRanking } from '@/shared/api/useRankingApi'
import { cn } from '@/shared/cn'
import { useAppStore } from '@/store'

const BAND_COUNT = 5

export function RankingTicker({ layout }: { layout: 'narrow' | 'wide' }) {
  const { data, isError } = useWeeklyRanking()
  const authSession = useAppStore((state) => state.authSession)
  const { data: myRank } = useMyWeeklyRank(authSession?.sessionToken ?? null)

  if (isError) return null

  const entries = data?.entries ?? []
  const band = entries.slice(0, BAND_COUNT)

  return (
    <section
      aria-label="이번 주 요트랭킹"
      className={cn('relative flex-none bg-landing-panel', '[@media(max-height:480px)]:hidden')}
    >
      {layout === 'wide' ? (
        <div className="mx-auto flex h-11 w-full max-w-landing justify-center">
          <WideBand
            band={band}
            entries={entries}
            loading={!data}
            myNickname={authSession?.nickname ?? null}
            myRank={myRank ?? null}
            myUserId={authSession?.userId ?? null}
          />
        </div>
      ) : (
        <div className="flex h-11 items-center gap-3 px-5">
          <TickerLabel />
          <TickerViewport>
            {band.length === 0 ? (
              <EmptyNotice loading={!data} />
            ) : band.length >= MIN_SCROLL_ENTRIES ? (
              <ScrollingTrack entries={band} myUserId={authSession?.userId ?? null} />
            ) : (
              <EntryRow entries={band} myUserId={authSession?.userId ?? null} />
            )}
          </TickerViewport>
        </div>
      )}

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] [background:var(--ds-landing-accent-line)]"
      />
    </section>
  )
}
