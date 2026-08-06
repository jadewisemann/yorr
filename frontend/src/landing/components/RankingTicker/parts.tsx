import type { WeeklyRankingEntry } from '@/shared/api/rankingApi'
import { cn } from '@/shared/cn'
import { IconChevron } from '@/shared/components/Icon'
import { SECONDS_PER_ENTRY } from './shared'

/**
 * narrow에서 이 수 미만이면 흘리지 않고 세워 둔다. 한 명뿐인데 흘리면 같은 이름만 끝없이
 * 되돌아와 "기록이 적다"가 "고장났다"로 읽힌다. 둘부터는 순위가 바뀌며 지나간다.
 */
export function Chevron({ open }: { open: boolean }) {
  return (
    <IconChevron
      className={cn('size-3.5 transition-transform duration-150 ease-out', open && 'rotate-180')}
    />
  )
}

/** 흐르지 않는 왼쪽 고정 라벨. 시세표의 거래소 이름 자리다 — 무엇이 흐르는지 먼저 말한다. */
export function TickerLabel() {
  return (
    <p className="m-0 flex flex-none items-center gap-2 text-xs/none font-landing-bold whitespace-nowrap text-landing-text">
      {/* 글로우를 뺀다 — RankBadge와 같은 이유다. 살아 있다는 신호는 맥동(ring-pulse)이
          이미 주고, 빛나는 레드는 CTA 몫이다. */}
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-landing-accent-text motion-safe:animate-ring-pulse"
      />
      이번 주 요트랭킹
    </p>
  )
}

/** 양끝을 흐리게 잘라 글자가 띠 밖으로 튀어나오는 대신 사라지게 한다. */
export function TickerViewport({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]">
      {children}
    </div>
  )
}

/**
 * 이 개수만큼의 항목이 <b>보이는 폭 밖에</b> 대기하고 있어야 한다. 되돌아가는 순간 화면을 채울
 * 것이 남아 있지 않으면 빈 구간이 지나가고, 그게 "숙 건너뛰는" 것으로 보인다.
 * <p>
 * narrow 레이아웃은 760px 미만이고 항목 하나가 대략 90~120px이므로 20개면 어떤 폭에서도 남는다.
 */
const OFFSCREEN_ITEM_BUFFER = 20

/**
 * 같은 목록을 여러 벌 이어 붙이고 <b>정확히 한 벌 폭만</b> 민다. 두 번째 벌이 첫 번째 벌 자리에
 * 도착하는 순간 프레임이 처음과 똑같아져 이어붙인 곳이 보이지 않는다.
 * <p>
 * <b>복제 수를 항목 개수로 정하는 이유.</b> 처음에는 두 벌을 넣고 -50%를 밀었는데, 한 벌이 띠
 * 폭보다 좁으면 뒤에 대기 중인 것이 없어 되돌아갈 때 눈에 보이게 튀었다. 그때 한 벌에
 * {@code min-w-full}을 줘서 폭을 채우려 했지만, 그 퍼센트는 부모인 트랙({@code w-max}) 기준으로
 * 풀려서 <b>한 벌 폭과 이동 거리가 어긋났다</b> — 같은 튐이 남은 진짜 원인이다.
 * <p>
 * 지금은 한 벌을 내용 폭 그대로 두고, 대기 항목이 {@link OFFSCREEN_ITEM_BUFFER}개 이상 되도록
 * 벌 수를 늘린다. 이동 거리는 트랙 폭의 1/복제수이므로 언제나 정확히 한 벌이다.
 * <p>
 * 첫 벌만 보조기기에 노출한다 — 나머지는 눈속임이라 함께 읽으면 순위를 여러 번 듣는다.
 */
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
        // 끝없이 도는 transform이므로 합성 레이어에 올려 둔다 — 아래에서 3D 히어로가 도는
        // 동안 이 띠가 메인 스레드의 레이아웃·페인트를 유발하지 않아야 한다.
        // motion-safe로 좁히는 이유: motion-reduce에서는 애니메이션이 아예 없으므로
        // 레이어를 붙잡고 있을 근거가 사라진다(will-change는 활성 애니메이션 동안만 쓴다).
        'motion-safe:will-change-transform',
        // 읽으려고 멈춰 세울 수 있어야 한다. hover만 두면 키보드·터치에는 멈출 방법이
        // 없으므로 focus-within도 같이 받는다 — 안에 링크·버튼이 없어도 흐르는 띠에
        // Tab이 닿는 순간 멈춰야 읽을 수 있다.
        'hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]',
        // 끝없이 흐르는 것은 vestibular 유발 요인이다. 멈춰 세우면 첫 벌만 남고 나머지는
        // 가로 스크롤로 직접 넘긴다(복제 벌은 아래에서 숨긴다).
        'motion-reduce:w-full motion-reduce:animate-none motion-reduce:overflow-x-auto',
      )}
      style={
        {
          // 한 벌 = 트랙 폭 ÷ 복제 수. 이 값이 어긋나면 되돌아가는 순간 튄다.
          '--ticker-shift': `-${(100 / copies).toFixed(4)}%`,
          // 속도는 항목당 고정이다 — 한 바퀴가 곧 한 벌이므로 항목 수에만 비례한다.
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
      // 폭은 내용 그대로다. min-width를 주면 한 벌 폭이 이동 거리와 어긋나 되돌아갈 때 튄다
      // (ScrollingTrack 주석 참고).
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
              // 흐르는 띠에서 내 이름이 지나갈 때 알아볼 수 있어야 한다. 배경을 칠하면 흐르는
              // 중에 덩어리가 튀어 시선을 끌어가므로 글자색만 바꾼다.
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

/** 점수만 mono다 — 자리수가 흔들리지 않아 흐르는 중에도, 열로 세워도 숫자로 읽힌다. */
export function Score({ value }: { value: number }) {
  return (
    <span className="flex-none font-mono text-sm/none font-bold text-landing-text tabular-nums">
      {value}
      <span className="ml-0.5 font-sans text-2xs font-normal text-landing-text-faint">점</span>
    </span>
  )
}

/**
 * 1위만 레드 배경이다. 띠 전체가 붉으면 무엇이 1위인지 형태로 구분되지 않는다.
 *
 * <b>글로우는 두지 않는다.</b> 배경색 반전만으로 이미 구분되고, 이 저장소는
 * {@link LandingProgress}에서 같은 판단을 이미 내려 뒀다 — "화면에서 유일하게 빛나는
 * 레드는 CTA여야 한다". 랭킹 띠는 랜딩 최상단에 있어서 글로우를 두면 그 아래 CTA와
 * 시선을 다툰다.
 */
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

/**
 * 아직 아무 기록도 없는 주. 빈 띠를 두는 대신 "여기 오를 수 있다"를 말한다 — 로그인해야
 * 오를 수 있으므로 이 자리가 곧 로그인할 이유가 된다.
 * <p>
 * 읽어오는 중에는 문구를 감추되 띠 높이는 그대로 둔다. 뒤늦게 나타나면 그만큼 히어로가
 * 줄어들며 화면이 한 번 튄다.
 */
export function EmptyNotice({ loading }: { loading: boolean }) {
  if (loading) return null

  // 문구는 320px에 맞춰 짧다. 이전 문구("이번 주 기록이 아직 없어요 — 로그인하고 첫 순위의
  // 주인이 되어보세요")는 narrow 뷰포트가 ~168px뿐이라 truncate가 앞머리만 남기고 **행동을
  // 통째로 잘라냈다** — 빈 상태에는 다음 행동이 하나 남아 있어야 한다.
  // 기록이 없다는 사실은 이름이 하나도 없는 것으로 이미 읽히고, 무엇의 순위인지는 왼쪽
  // 고정 라벨("이번 주 요트랭킹")이 말한다. 그래서 남길 것은 행동뿐이다.
  return (
    <p className="m-0 truncate text-xs/none font-landing-medium text-landing-text-faint">
      로그인하고 1위 도전하기
    </p>
  )
}
