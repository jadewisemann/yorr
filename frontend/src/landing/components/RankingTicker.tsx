import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { MyWeeklyRank, WeeklyRankingEntry } from '@/shared/api/rankingApi'
import { useMyWeeklyRank, useWeeklyRanking } from '@/shared/api/useRankingApi'
import { cn } from '@/shared/cn'
import { popVariants } from '@/shared/motion'
import { useAppStore } from '@/store'

/**
 * narrow에서 이 수 미만이면 흘리지 않고 세워 둔다. 한 명뿐인데 흘리면 같은 이름만 끝없이
 * 되돌아와 "기록이 적다"가 "고장났다"로 읽힌다. 둘부터는 순위가 바뀌며 지나간다.
 */
const MIN_SCROLL_ENTRIES = 2

/** 항목 하나가 화면을 지나가는 데 쓰는 시간. 항목이 늘어도 읽는 속도가 그대로여야 한다. */
const SECONDS_PER_ENTRY = 4.5

/** 띠에 세워 두는 인원. 나머지는 드롭다운(wide)이 받는다. */
const BAND_COUNT = 5

const PANEL_ID = 'weekly-ranking-panel'

/**
 * 랜딩 최상단에 얹히는 주간 랭킹 띠.
 * <p>
 * <b>레이아웃마다 다른 것을 한다.</b>
 * <ul>
 *   <li><b>narrow</b> — 증권 시세표처럼 옆으로 흐른다. 좁은 폭에 순위를 여러 개 세울 자리가
 *       없고, 손가락으로 펼치는 동작 하나를 아끼는 편이 낫다.
 *   <li><b>wide</b> — 흐르지 않는다. 데스크톱에서는 움직이는 글자를 눈으로 따라가는 것이
 *       읽는 게 아니라 기다리는 일이 된다. 상위 몇 명을 세워 두고, 전체는 드롭다운으로 펼친다.
 * </ul>
 * <p>
 * 흐르는 쪽은 <b>CSS keyframes</b>다 — 이 띠 아래에서 3D 히어로가 rapier 스텝을 돌리므로
 * 끝없이 도는 것에 JS 프레임을 쓰면 같은 프레임을 다툰다. 반대로 드롭다운의 펼침·접힘은
 * 언마운트를 붙잡아야 하므로 <b>motion</b>이 맡는다(design-system.md의 모션 경계).
 * <p>
 * 실패하면 <b>아무것도 그리지 않는다.</b> 랭킹은 부가 정보라, 못 읽었다는 사실을 랜딩 최상단에
 * 얹어 알릴 만한 일이 아니다.
 */
export function RankingTicker({ layout }: { layout: 'narrow' | 'wide' }) {
  const { data, isError } = useWeeklyRanking()
  const authSession = useAppStore((state) => state.authSession)
  // 로그인하지 않았으면 묻지 않는다. 게스트에게 "내 순위"는 존재하지 않는 개념이다.
  const { data: myRank } = useMyWeeklyRank(authSession?.sessionToken ?? null)

  if (isError) return null

  const entries = data?.entries ?? []
  const band = entries.slice(0, BAND_COUNT)

  return (
    <section
      aria-label="이번 주 파워랭킹"
      className={cn(
        // 배경은 landing-panel(86% 불투명)이다. landing-well은 배경 바탕(#08090a)을 같은 색
        // 55%로 얹은 값이라 랜딩 위에서 아예 분리되지 않는다 — 띠가 있는 줄도 모른다.
        'relative flex-none bg-landing-panel',
        // 짧은 가로 화면(932×430 등)에서는 접는다. 랜딩은 h-svh + overflow-hidden이라 크롬이
        // 한 층 늘면 아래 내용이 잘려 접근 불가가 된다 — 그 높이에서는 히어로가 우선이다.
        '[@media(max-height:480px)]:hidden',
      )}
    >
      {layout === 'wide' ? (
        // 헤더와 같은 이중 래퍼다 — 안쪽 69.4%에 맞춰야 워드마크 왼쪽 끝과 랭킹 라벨 왼쪽
        // 끝이 같은 세로선에 선다. 띠 전체 폭에 걸치면 헤더에 얹힌 게 아니라 떠 보인다.
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

      {/* 히어로 카드 하단과 같은 액센트 선(--ds-landing-accent-line)이다. 같은 형태를 다시
          쓰면 띠가 랜딩에 원래 있던 층으로 읽히고, 헤더와의 경계도 hairline보다 분명해진다. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] [background:var(--ds-landing-accent-line)]"
      />
    </section>
  )
}

/**
 * wide 띠. 상위 몇 명을 세워 두고 나머지는 드롭다운으로 넘긴다.
 * <p>
 * 흐르지 않으므로 <b>몇 명이 더 있는지를 글자로 말해야 한다</b> — 흐르는 띠는 기다리면 다음이
 * 나오지만, 세워 둔 띠는 잘린 곳에서 끝난 것처럼 보인다.
 */
function WideBand({
  band,
  entries,
  loading,
  myNickname,
  myRank,
  myUserId,
}: {
  band: WeeklyRankingEntry[]
  entries: WeeklyRankingEntry[]
  loading: boolean
  myNickname: string | null
  myRank: MyWeeklyRank | null
  myUserId: string | null
}) {
  const [open, setOpen] = useState(false)
  const hidden = entries.length - band.length

  // 띠가 사라지거나 목록이 비면 열린 드롭다운도 함께 닫는다. 안 그러면 빈 패널이 남는다.
  useEffect(() => {
    if (entries.length === 0) setOpen(false)
  }, [entries.length])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div className="relative flex w-[69.4%] items-center gap-3.5">
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
            'flex h-full flex-none cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-[12.5px] font-landing-bold transition-colors duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2',
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
          <>
            {/* 바깥을 눌러 닫는 길. 모달이 아니므로 스크림을 어둡게 하거나 뒤 화면을 inert로
                잠그지 않는다 — 드롭다운은 랜딩을 계속 쓰면서 곁눈질하는 것이다. */}
            <button
              aria-label="랭킹 닫기"
              className="fixed inset-0 z-banner cursor-default border-0 bg-transparent"
              onClick={() => setOpen(false)}
              tabIndex={-1}
              type="button"
            />
            <motion.div
              animate="visible"
              className="absolute top-full right-0 z-banner mt-2.5 w-90 rounded-[18px] border border-landing-hairline-strong bg-surface-raised p-2 shadow-landing-popover"
              exit="exit"
              id={PANEL_ID}
              initial="hidden"
              // 버튼(오른쪽 끝)에서 자라야 무엇을 눌러 열렸는지가 위치로 읽힌다.
              style={{ transformOrigin: 'top right' }}
              variants={popVariants}
            >
              <FullRanking
                entries={entries}
                myNickname={myNickname}
                myRank={myRank}
                myUserId={myUserId}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * 드롭다운 안 전체 순위. 띠와 달리 세로로 세우므로 이름과 점수가 열로 정렬된다.
 * <p>
 * <b>목록 안에 내가 없으면 내 줄을 따로 잇는다.</b> 상위 10명만 보여주면 11위부터는 랭킹이
 * 남의 이야기가 된다 — 자기 자리를 알 수 있어야 다음 판을 할 이유가 생긴다. 중간을 건너뛴 것을
 * 말하지 않으면 내가 11위인 것처럼 읽히므로 생략 표시를 사이에 둔다.
 */
function FullRanking({
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
          <p
            aria-hidden="true"
            className="m-0 py-0.5 text-center text-[11px]/none text-landing-text-faint"
          >
            ⋯
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

function FullRankingRow({ entry, mine }: { entry: WeeklyRankingEntry; mine: boolean }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-[12px] px-2.5 py-2',
        // 1위는 색으로, 나는 테두리로 구분한다 — 둘 다 배경을 칠하면 내가 1위일 때 겹쳐
        // 어느 쪽 강조인지 읽히지 않는다.
        entry.rank === 1 && 'bg-landing-accent-tint',
        mine && 'ring-1 ring-landing-hairline-strong ring-inset',
      )}
    >
      <RankBadge rank={entry.rank} />
      <span className="min-w-0 flex-1 truncate text-[14px]/none font-landing-medium text-landing-text-strong">
        {entry.nickname}
        {mine && (
          <span className="ml-1.5 text-[11px] font-normal text-landing-accent-text">나</span>
        )}
      </span>
      <Score value={entry.bestScore} />
    </li>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'text-[9px]/none transition-transform duration-150 ease-out',
        open && 'rotate-180',
      )}
    >
      ▼
    </span>
  )
}

/** 흐르지 않는 왼쪽 고정 라벨. 시세표의 거래소 이름 자리다 — 무엇이 흐르는지 먼저 말한다. */
function TickerLabel() {
  return (
    <p className="m-0 flex flex-none items-center gap-2 text-[12px]/none font-landing-bold whitespace-nowrap text-landing-text">
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-landing-accent-text shadow-[0_0_10px_currentColor] motion-safe:animate-ring-pulse"
      />
      이번 주 파워랭킹
    </p>
  )
}

/** 양끝을 흐리게 잘라 글자가 띠 밖으로 튀어나오는 대신 사라지게 한다. */
function TickerViewport({ children }: { children: React.ReactNode }) {
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
function ScrollingTrack({
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
        'will-change-transform',
        // 읽으려고 멈춰 세울 수 있어야 한다.
        'hover:[animation-play-state:paused]',
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

function EntryRow({
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
              'text-[14px]/none font-landing-medium',
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
function Score({ value }: { value: number }) {
  return (
    <span className="flex-none font-mono text-[15px]/none font-bold text-landing-text tabular-nums">
      {value}
      <span className="ml-0.5 font-sans text-[11px] font-normal text-landing-text-faint">점</span>
    </span>
  )
}

/** 1위만 레드에 글로우다. 띠 전체가 붉으면 무엇이 1위인지 형태로 구분되지 않는다. */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'grid size-5.5 flex-none place-items-center rounded-[6px] font-mono text-[11px]/none font-bold tabular-nums',
        rank === 1
          ? 'bg-landing-accent text-landing-accent-ink shadow-[0_0_12px_var(--ds-landing-accent-tint)]'
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
function EmptyNotice({ loading }: { loading: boolean }) {
  if (loading) return null

  return (
    <p className="m-0 truncate text-[12px]/none font-landing-medium text-landing-text-faint">
      이번 주 기록이 아직 없어요 — 로그인하고 첫 순위의 주인이 되어보세요
    </p>
  )
}
