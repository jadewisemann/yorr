import type { CSSProperties, ReactNode } from 'react'
import type { PlayerId, ScoreBoard } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import {
  type CategoryScores,
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  type YachtCategory,
} from '@/yacht/domain/scoring'
import { categoryLabel, isRecorded } from '@/yacht/domain/yachtCategoryView'
import { CategoryIcon } from '../CategoryIcon'
import { scoreCell } from './PlayerBadge'

export interface ScoreRowPlayer {
  nickname: string
  playerId: PlayerId
  scoreboard: ScoreBoard | undefined
}

interface ScoreRowOptions {
  category: YachtCategory
  players: ScoreRowPlayer[]
  activePlayerId: PlayerId | undefined
  leverageCategory: YachtCategory | null
  columns: CSSProperties
  preview: number | null
  clickable: boolean
  onPick: (category: YachtCategory) => void
}

const cellHighlight = (playerId: PlayerId, activePlayerId: PlayerId | undefined) =>
  playerId === activePlayerId ? 'bg-surface' : undefined

/** 내 차례에 굴렸을 때 이 족보로 얻을 점수(아직 기록 안 한 칸만). */
export function previewOf(options: {
  activePlayer: ScoreRowPlayer | undefined
  rolled: boolean
  category: YachtCategory
  candidates: CategoryScores
}): number | null {
  const { activePlayer, rolled, category, candidates } = options
  if (!activePlayer || !rolled) return null
  if (isRecorded(activePlayer.scoreboard?.categories[category])) return null
  return candidates[category] ?? 0
}

/** 점수표의 족보 한 줄. 기록 가능하면 버튼, 아니면 같은 모양의 정적 행이다. */
export function ScoreRow(options: ScoreRowOptions) {
  const { category, players, activePlayerId, leverageCategory, columns, preview, clickable } =
    options
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
      {leveraged && <LeverageBadge />}
    </span>
  )
  const cells = players.map((player) => (
    <ScoreCell
      activePlayerId={activePlayerId}
      category={category}
      key={player.playerId}
      player={player}
      preview={preview}
    />
  ))

  if (!clickable) {
    return (
      <div className={rowClassName} data-tutorial-category={category} style={columns}>
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
      onClick={() => options.onPick(category)}
      style={columns}
      type="button"
    >
      {label}
      {cells}
    </button>
  )
}

function LeverageBadge() {
  return (
    <span className="flex-none rounded-full bg-brand px-1.5 font-mono text-2xs font-bold text-on-brand">
      ×2
    </span>
  )
}

function ScoreCell(options: {
  activePlayerId: PlayerId | undefined
  category: YachtCategory
  player: ScoreRowPlayer
  preview: number | null
}) {
  const { activePlayerId, category, player, preview } = options
  const value = player.scoreboard?.categories[category]
  const isPreviewCell = player.playerId === activePlayerId && preview !== null
  const cell = scoreCell(value, preview, isPreviewCell)
  return (
    <span
      className={cn('score-cell', cellHighlight(player.playerId, activePlayerId), cell.className)}
    >
      {cell.content}
    </span>
  )
}

interface MetaRowOptions {
  label: ReactNode
  values: string[]
  columns: CSSProperties
  players: ScoreRowPlayer[]
  activePlayerId: PlayerId | undefined
  achieved?: boolean[]
  emphasis?: boolean
}

/** 보너스·합계처럼 족보가 아닌 행. 강조 여부만 다르고 열 정렬을 공유한다. */
export function MetaRow(options: MetaRowOptions) {
  const { label, values, columns, players, activePlayerId, achieved, emphasis = false } = options
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
      <span className="truncate text-2xs font-bold tracking-[0.08em] text-content-muted uppercase">
        {label}
      </span>
      {values.map((value, index) => (
        <span
          className={cn(
            'text-center font-mono font-bold tabular-nums',
            emphasis
              ? 'text-xl text-brand-strong'
              : achieved?.[index]
                ? // 보너스 달성 강조(QA 피드백) — 달성한 플레이어의 셀만 brand로 띄운다.
                  'text-xs text-brand-strong'
                : 'text-xs text-content-muted',
            cellHighlight(players[index]?.playerId ?? '', activePlayerId),
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

/** 소계·보너스·합계 행의 값과 강조를 한 곳에서 계산한다(화면에는 JSX만 남긴다). */
export function metaRowsOf(players: ScoreRowPlayer[]) {
  return {
    bonus: players.map((player) =>
      (player.scoreboard?.upperBonus ?? 0) > 0 ? `+${UPPER_BONUS_POINTS}` : '—',
    ),
    bonusAchieved: players.map((player) => (player.scoreboard?.upperBonus ?? 0) > 0),
    subtotal: players.map((player) => String(player.scoreboard?.upperSubtotal ?? 0)),
    subtotalAchieved: players.map(
      (player) => (player.scoreboard?.upperSubtotal ?? 0) >= UPPER_BONUS_THRESHOLD,
    ),
    total: players.map((player) => String(player.scoreboard?.total ?? 0)),
  }
}
