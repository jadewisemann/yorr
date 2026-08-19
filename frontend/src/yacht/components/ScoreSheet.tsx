import type { ReactNode } from 'react'
import type { PlayerId, ScoreBoard } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { Tooltip } from '@/shared/components/Tooltip'
import { PlayerBadge, scoreCell } from '@/yacht/components/ScoreSheet/PlayerBadge'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_LOWER_CATEGORIES,
  YACHT_UPPER_CATEGORIES,
} from '@/yacht/domain/scoring'
import { categoryLabel, isRecorded } from '@/yacht/domain/yachtCategoryView'
import { CategoryIcon } from './CategoryIcon'

export interface ScoreSheetPlayer {
  nickname: string
  playerId: PlayerId
  scoreboard: ScoreBoard | undefined
}

interface ScoreSheetProps {
  activePlayerId?: PlayerId | undefined
  candidates: CategoryScores
  canPick: boolean
  className?: string
  'data-tutorial'?: string
  header?: ReactNode
  leverageCategory?: YachtCategory | null
  onPick: (category: YachtCategory) => void
  players: ScoreSheetPlayer[]
  you: PlayerId
}

/*
 * 200줄 기준선을 조금 넘긴다(원칙 7) — 점수표는 상단 6칸·보너스 행·족보 6칸이
 * 열 수·정렬·강조 규칙을 공유하는 한 장의 표라, 행 종류별로 가르면 공유 규칙이
 * 파일마다 복제된다. 행 렌더링 자체는 이미 ScoreRow/ScoreMatrix가 들고 있다.
 */
export function ScoreSheet({
  activePlayerId,
  candidates,
  canPick,
  className,
  'data-tutorial': dataTutorial,
  header,
  leverageCategory = null,
  onPick,
  players,
  you,
}: ScoreSheetProps) {
  const rolled = Object.keys(candidates).length > 0
  const activePlayer = players.find((player) => player.playerId === activePlayerId)
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
      const cell = scoreCell(value, preview, isPreviewCell)
      return (
        <span
          className={cn('score-cell', cellHighlight(player.playerId), cell.className)}
          key={player.playerId}
        >
          {cell.content}
        </span>
      )
    })

    const leveraged = category === leverageCategory
    const rowClassName = cn(
      'score-row',
      leveraged && 'border-l-3 border-l-brand bg-brand/8',
      clickable &&
        'focus-ring cursor-pointer transition-colors hover:bg-brand/10 focus-visible:outline-offset-[-3px]',
    )
    const label = (
      <span className="score-label">
        <CategoryIcon category={category} className="size-4 flex-none text-content-muted" />
        <span className="truncate">{categoryLabel[category]}</span>
        {leveraged && (
          <span className="flex-none rounded-full bg-brand px-1.5 font-mono text-2xs font-bold text-on-brand">
            ×2
          </span>
        )}
      </span>
    )

    if (!clickable) {
      return (
        <div
          className={rowClassName}
          data-tutorial-category={category}
          key={category}
          style={columns}
        >
          {label}
          {cells}
        </div>
      )
    }
    return (
      <button
        aria-label={`${categoryLabel[category]}${leveraged ? ' 2배' : ''} ${preview}`}
        className={rowClassName}
        data-tutorial-category={category}
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
          'grid shrink-0 grow basis-auto items-center gap-1 px-3',
          emphasis
            ? 'max-h-18 min-h-12 border-t-2 border-border'
            : 'max-h-12 min-h-8 border-y border-border bg-surface-sunken',
        )}
        style={columns}
      >
        <span
          className={cn(
            'truncate font-bold tracking-[0.08em] uppercase',
            emphasis ? 'text-2xs text-content-muted' : 'text-2xs text-content-muted',
          )}
        >
          {label}
        </span>
        {values.map((value, index) => (
          <span
            className={cn(
              'text-center font-mono font-bold tabular-nums',
              emphasis
                ? 'text-xl text-brand-strong'
                : options?.achieved?.[index]
                  ? // 보너스 달성 강조(QA 피드백) — 달성한 플레이어의 셀만 brand로 띄운다.
                    'text-xs text-brand-strong'
                  : 'text-xs text-content-muted',
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
      className={cn(
        'flex flex-col overflow-auto overscroll-contain shrink-0 grow basis-auto justify-center-safe',
        className,
      )}
      data-tutorial={dataTutorial}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤 영역은 포커스를 받아야 한다
      tabIndex={0}
    >
      <div className="sticky top-0 z-sticky bg-canvas">
        {header}
        <div
          className="grid min-h-9 items-center gap-1 border-b border-border px-3"
          style={columns}
        >
          <span className="flex items-center gap-1.5 text-2xs font-bold tracking-[0.08em] text-content-muted uppercase">
            족보
            <Tooltip
              align="start"
              content="내 차례에 굴리면 내 열에 미리보기 점수가 떠요. 그 숫자를 탭하면 바로 기록됩니다."
              label="점수 기록 방법"
            />
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
