import type { WeeklyRankingEntry } from '@/shared/api/rankingApi'
import { cn } from '@/shared/cn'
import { IconChevron } from '@/shared/components/Icon'
import { SECONDS_PER_ENTRY } from './shared'

export function Chevron({ open }: { open: boolean }) {
  return (
    <IconChevron
      className={cn('size-3.5 transition-transform duration-150 ease-out', open && 'rotate-180')}
    />
  )
}

export function TickerLabel() {
  return (
    <p className="m-0 flex flex-none items-center gap-2 text-xs/none font-landing-bold whitespace-nowrap text-landing-text">
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-landing-accent-text motion-safe:animate-ring-pulse"
      />
      이번 주 요트랭킹
    </p>
  )
}

export function TickerViewport({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]">
      {children}
    </div>
  )
}

const OFFSCREEN_ITEM_BUFFER = 20

export function ScrollingTrack({
  entries,
  myUserId,
}: {
  entries: WeeklyRankingEntry[]
  myUserId: string | null
}) {
  const copies = Math.max(2, Math.ceil(OFFSCREEN_ITEM_BUFFER / entries.length) + 1)

  return (
    <div
      className={cn(
        'flex w-max animate-ticker-scroll',
        'motion-safe:will-change-transform',
        'hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]',
        'motion-reduce:w-full motion-reduce:animate-none motion-reduce:overflow-x-auto',
      )}
      style={
        {
          '--ticker-shift': `-${(100 / copies).toFixed(4)}%`,
          animationDuration: `${(entries.length * SECONDS_PER_ENTRY).toFixed(1)}s`,
        } as React.CSSProperties
      }
    >
      {Array.from({ length: copies }, (_, copy) => (
        <EntryRow
          aria-hidden={copy > 0}
          className={copy > 0 ? 'motion-reduce:hidden' : undefined}
          entries={entries}
          // biome-ignore lint/suspicious/noArrayIndexKey: 복제 벌은 내용이 같고 재정렬도 없어 순서가 곧 정체성이다
          key={copy}
          myUserId={myUserId}
        />
      ))}
    </div>
  )
}

export function EntryRow({
  'aria-hidden': ariaHidden,
  className,
  entries,
  myUserId,
}: {
  'aria-hidden'?: boolean
  className?: string | undefined
  entries: WeeklyRankingEntry[]
  myUserId: string | null
}) {
  return (
    <ol
      aria-hidden={ariaHidden}
      className={cn('m-0 flex flex-none list-none items-center p-0', className)}
    >
      {entries.map((entry) => (
        <li
          className="flex items-center gap-2 border-l border-landing-hairline px-3.5 whitespace-nowrap first:border-l-0 first:pl-0"
          key={`${entry.rank}-${entry.userId}`}
        >
          <RankBadge rank={entry.rank} />
          <span
            className={cn(
              'text-sm/none font-landing-medium',
              entry.userId === myUserId ? 'text-landing-accent-text' : 'text-landing-text-strong',
            )}
          >
            {entry.nickname}
          </span>
          <Score value={entry.bestScore} />
        </li>
      ))}
    </ol>
  )
}

export function Score({ value }: { value: number }) {
  return (
    <span className="flex-none font-mono text-sm/none font-bold text-landing-text tabular-nums">
      {value}
      <span className="ml-0.5 font-sans text-2xs font-normal text-landing-text-faint">점</span>
    </span>
  )
}

export function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'grid size-5.5 flex-none place-items-center rounded-chip font-mono text-2xs/none font-bold tabular-nums',
        rank === 1
          ? 'bg-landing-accent text-landing-accent-ink'
          : 'bg-landing-soft text-landing-text-muted',
      )}
    >
      {rank}
    </span>
  )
}

export function EmptyNotice({ loading }: { loading: boolean }) {
  if (loading) return null

  return (
    <p className="m-0 truncate text-xs/none font-landing-medium text-landing-text-faint">
      로그인하고 1위 도전하기
    </p>
  )
}
