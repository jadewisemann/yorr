import { cn } from '@/cn'
import type { CategoryScores, YachtCategory } from '@/domain/scoring'
import {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_LOWER_CATEGORIES,
  YACHT_UPPER_CATEGORIES,
} from '@/domain/scoring'
import type { PlayerId, ScoreBoard } from '@/realtime/wsEvents'
import { categoryLabel, isRecorded } from '@/yachtCategoryView'
import { CategoryIcon } from './CategoryIcon'

export interface ScoreSheetPlayer {
  nickname: string
  playerId: PlayerId
  scoreboard: ScoreBoard | undefined
}

interface ScoreSheetProps {
  /** 지금 턴인 플레이어. 해당 열을 하이라이트한다. */
  activePlayerId?: PlayerId | undefined
  /** 현재 주사위로 얻을 수 있는 점수. 굴리기 전이면 비어 있다. */
  candidates: CategoryScores
  /** 내 열의 미기입 행을 탭하면 바로 기록할 수 있는 상태인지. */
  canPick: boolean
  className?: string
  onPick: (category: YachtCategory) => void
  players: ScoreSheetPlayer[]
  you: PlayerId
}

/** 플레이어 머리글자 칩. 헤더·트레이에서도 같은 표기를 쓰도록 내보낸다. */
export function PlayerBadge({
  active = false,
  nickname,
  size = 'md',
}: {
  active?: boolean
  nickname: string
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border font-bold',
        size === 'md' ? 'size-7 text-[11px]' : 'size-6 text-[10px]',
        active
          ? 'border-brand bg-brand text-on-brand'
          : 'border-border bg-surface text-content-muted',
      )}
      title={nickname}
    >
      {initialsOf(nickname)}
    </span>
  )
}

/**
 * 디자인 Yacht Play Screens의 점수시트 — 모든 플레이어를 열로 눕힌 한 장.
 * 내 열의 미기입 행에는 굴림 미리보기 점수가 뜨고, 행을 탭하면 바로 기록된다.
 */
export function ScoreSheet({
  activePlayerId,
  candidates,
  canPick,
  className,
  onPick,
  players,
  you,
}: ScoreSheetProps) {
  const rolled = Object.keys(candidates).length > 0
  const activePlayer = players.find((player) => player.playerId === activePlayerId)
  // 첫 열은 아이콘+한글 라벨("스몰 스트레이트")이 320px 2열에서도 잘리지 않을 폭.
  const columns = {
    gridTemplateColumns: `minmax(8rem, 1.3fr) repeat(${players.length}, minmax(2.75rem, 1fr))`,
  }

  const cellHighlight = (playerId: PlayerId) =>
    playerId === activePlayerId ? 'bg-surface' : undefined

  const renderCategoryRow = (category: YachtCategory) => {
    const activeRecorded = activePlayer?.scoreboard?.categories[category]
    const preview =
      activePlayer && !isRecorded(activeRecorded) && rolled ? (candidates[category] ?? 0) : null
    const clickable = activePlayerId === you && canPick && preview !== null

    const cells = players.map((player) => {
      const value = player.scoreboard?.categories[category]
      const isPreviewCell = player.playerId === activePlayerId && preview !== null
      return (
        <span
          className={cn(
            'justify-self-stretch py-1 text-center font-mono text-[15px] font-bold tabular-nums',
            cellHighlight(player.playerId),
            isPreviewCell
              ? 'bg-brand/15 text-brand-strong'
              : isRecorded(value)
                ? value === 0
                  ? 'text-danger'
                  : 'text-content'
                : 'text-content-faint',
          )}
          key={player.playerId}
        >
          {isPreviewCell ? preview : isRecorded(value) ? value : '·'}
        </span>
      )
    })

    const rowClassName = cn(
      'grid min-h-11 w-full items-center gap-1 border-0 border-b border-border/40 bg-transparent px-3 text-left',
      clickable &&
        'cursor-pointer transition-colors hover:bg-brand/10 focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-[-3px]',
    )
    const label = (
      <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-content">
        <CategoryIcon category={category} className="size-4 flex-none text-content-muted" />
        <span className="truncate">{categoryLabel[category]}</span>
      </span>
    )

    if (!clickable) {
      return (
        <div className={rowClassName} key={category} style={columns}>
          {label}
          {cells}
        </div>
      )
    }
    return (
      <button
        aria-label={`${categoryLabel[category]} ${preview}`}
        className={rowClassName}
        key={category}
        onClick={() => onPick(category)}
        style={columns}
        type="button"
      >
        {label}
        {cells}
      </button>
    )
  }

  const metaRow = (
    label: string,
    values: string[],
    options?: { achieved?: boolean[]; emphasis?: boolean },
  ) => {
    const emphasis = options?.emphasis ?? false
    return (
      <div
        className={cn(
          'grid items-center gap-1 px-3',
          emphasis
            ? 'min-h-12 border-t-2 border-border'
            : 'min-h-8 border-y border-border bg-surface-sunken',
        )}
        style={columns}
      >
        <span
          className={cn(
            'truncate font-bold tracking-[0.08em] uppercase',
            emphasis ? 'text-[11px] text-content-muted' : 'text-[10.5px] text-content-muted',
          )}
        >
          {label}
        </span>
        {values.map((value, index) => (
          <span
            className={cn(
              'text-center font-mono font-bold tabular-nums',
              emphasis
                ? 'text-[20px] text-brand-strong'
                : options?.achieved?.[index]
                  ? // 보너스 달성 강조(QA S15P11A406-102) — 달성한 플레이어의 셀만 brand로 띄운다.
                    'text-[13px] text-brand-strong'
                  : 'text-[12px] text-content-muted',
              cellHighlight(players[index]?.playerId ?? ''),
            )}
            // biome-ignore lint/suspicious/noArrayIndexKey: 열 순서 = players 순서로 고정이다
            key={index}
          >
            {value}
          </span>
        ))}
      </div>
    )
  }

  return (
    <section
      aria-label="플레이어별 점수표"
      // overscroll-contain: 시트 스크롤이 끝에 닿아도 뒤 페이지로 번지지 않는다.
      className={cn('overflow-auto overscroll-contain', className)}
      // 표 안에 포커스 요소가 없을 수 있어 스크롤 컨테이너가 tab을 받아야 한다(WCAG 2.1.1).
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤 영역은 포커스를 받아야 한다
      tabIndex={0}
    >
      <div
        className="sticky top-0 z-sticky grid min-h-9 items-center gap-1 border-b border-border bg-canvas px-3"
        style={columns}
      >
        <span className="text-[10px] font-bold tracking-[0.08em] text-content-muted uppercase">
          족보
        </span>
        {players.map((player) => (
          <span className="justify-self-center" key={player.playerId}>
            <PlayerBadge
              active={player.playerId === activePlayerId}
              nickname={player.nickname}
              size="sm"
            />
          </span>
        ))}
      </div>

      {YACHT_UPPER_CATEGORIES.map(renderCategoryRow)}
      {metaRow(
        `소계 / ${UPPER_BONUS_THRESHOLD}`,
        players.map((player) => String(player.scoreboard?.upperSubtotal ?? 0)),
        {
          achieved: players.map(
            (player) => (player.scoreboard?.upperSubtotal ?? 0) >= UPPER_BONUS_THRESHOLD,
          ),
        },
      )}
      {metaRow(
        `보너스 +${UPPER_BONUS_POINTS}`,
        players.map((player) =>
          (player.scoreboard?.upperBonus ?? 0) > 0 ? `+${UPPER_BONUS_POINTS}` : '—',
        ),
        { achieved: players.map((player) => (player.scoreboard?.upperBonus ?? 0) > 0) },
      )}
      {YACHT_LOWER_CATEGORIES.map(renderCategoryRow)}
      {metaRow(
        '합계',
        players.map((player) => String(player.scoreboard?.total ?? 0)),
        { emphasis: true },
      )}
    </section>
  )
}

/** 한글 닉네임은 앞 두 글자, 라틴은 단어 머리글자. 디자인의 아바타 표기 규칙. */
function initialsOf(nickname: string) {
  if (/[가-힣]/.test(nickname)) return nickname.slice(0, 2)
  const parts = nickname.split(/[\s'’-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? nickname[0] ?? '?'
  const second = parts[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}
