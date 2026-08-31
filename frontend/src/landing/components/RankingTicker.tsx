import { NarrowBand } from '@/landing/components/RankingTicker/NarrowBand'
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
  const bandProps = {
    band,
    entries,
    loading: !data,
    myNickname: authSession?.nickname ?? null,
    myRank: myRank ?? null,
    myUserId: authSession?.userId ?? null,
  }

  return (
    <section
      aria-label="이번 주 요트랭킹"
      className={cn('relative flex-none bg-landing-panel', '[@media(max-height:480px)]:hidden')}
    >
      {layout === 'wide' ? (
        <div className="mx-auto flex h-11 w-full max-w-landing justify-center">
          <WideBand {...bandProps} />
        </div>
      ) : (
        <NarrowBand {...bandProps} />
      )}

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] [background:var(--ds-landing-accent-line)]"
      />
    </section>
  )
}
