import type { MyWeeklyRank, WeeklyRankingEntry } from '@/shared/api/rankingApi'
import { cn } from '@/shared/cn'
import { IconEllipsis } from '@/shared/components/Icon'
import { RankBadge, Score } from './parts'

export function FullRankingRow({ entry, mine }: { entry: WeeklyRankingEntry; mine: boolean }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-control px-2.5 py-2',
        entry.rank === 1 && 'bg-landing-accent-tint',
        mine && 'ring-1 ring-landing-hairline-strong ring-inset',
      )}
    >
      <RankBadge rank={entry.rank} />
      <span className="min-w-0 flex-1 truncate text-sm/none font-landing-medium text-landing-text-strong">
        {entry.nickname}
        {mine && <span className="ml-1.5 text-2xs font-normal text-landing-accent-text">나</span>}
      </span>
      <Score value={entry.bestScore} />
    </li>
  )
}

export function FullRanking({
  entries,
  myNickname,
  myRank,
  myUserId,
}: {
  entries: WeeklyRankingEntry[]
  myNickname: string | null
  myRank: MyWeeklyRank | null
  myUserId: string | null
}) {
  const listedMe = myUserId !== null && entries.some((entry) => entry.userId === myUserId)
  const appendMe = myRank !== null && !listedMe

  return (
    <>
      <ol aria-label="이번 주 순위" className="m-0 flex list-none flex-col p-0">
        {entries.map((entry) => (
          <FullRankingRow
            entry={entry}
            key={`${entry.rank}-${entry.userId}`}
            mine={entry.userId === myUserId}
          />
        ))}
      </ol>

      {appendMe && (
        <>
          <p aria-hidden="true" className="m-0 flex justify-center py-0.5 text-landing-text-faint">
            <IconEllipsis className="size-4" />
          </p>
          <ol aria-label="내 순위" className="m-0 flex list-none flex-col p-0">
            <FullRankingRow
              entry={{
                bestScore: myRank.bestScore,
                nickname: myNickname ?? '내 기록',
                rank: myRank.rank,
                userId: myUserId ?? 'me',
              }}
              mine
            />
          </ol>
        </>
      )}
    </>
  )
}
