import type { MyWeeklyRank, WeeklyRankingEntry } from '@/shared/api/rankingApi'
import { cn } from '@/shared/cn'
import { IconEllipsis } from '@/shared/components/Icon'
import { RankBadge, Score } from './parts'

/**
 * narrow에서 이 수 미만이면 흘리지 않고 세워 둔다. 한 명뿐인데 흘리면 같은 이름만 끝없이
 * 되돌아와 "기록이 적다"가 "고장났다"로 읽힌다. 둘부터는 순위가 바뀌며 지나간다.
 */
export function FullRankingRow({ entry, mine }: { entry: WeeklyRankingEntry; mine: boolean }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-control px-2.5 py-2',
        // 1위는 색으로, 나는 테두리로 구분한다 — 둘 다 배경을 칠하면 내가 1위일 때 겹쳐
        // 어느 쪽 강조인지 읽히지 않는다.
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

/**
 * 드롭다운 안 전체 순위. 띠와 달리 세로로 세우므로 이름과 점수가 열로 정렬된다.
 * <p>
 * <b>목록 안에 내가 없으면 내 줄을 따로 잇는다.</b> 상위 10명만 보여주면 11위부터는 랭킹이
 * 남의 이야기가 된다 — 자기 자리를 알 수 있어야 다음 판을 할 이유가 생긴다. 중간을 건너뛴 것을
 * 말하지 않으면 내가 11위인 것처럼 읽히므로 생략 표시를 사이에 둔다.
 */
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
