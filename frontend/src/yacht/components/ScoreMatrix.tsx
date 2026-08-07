import type { ReactNode } from 'react'
import type { PlayerId, ScoreBoard } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_LOWER_CATEGORIES,
  YACHT_UPPER_CATEGORIES,
  type YachtCategory,
} from '@/yacht/domain/scoring'
import { categoryLabel } from '@/yacht/domain/yachtCategoryView'
import { CategoryIcon } from './CategoryIcon'

interface ScoreMatrixPlayer {
  nickname: string
  playerId: PlayerId
  scoreboard: ScoreBoard | undefined
}

interface ScoreMatrixProps {
  className?: string
  players: ScoreMatrixPlayer[]
}

const stickyLabel = 'sticky left-0 z-sticky px-3 py-2.5 text-left'

export function ScoreMatrix({ className, players }: ScoreMatrixProps) {
  const renderRows = (categories: readonly YachtCategory[]) =>
    categories.map((category) => (
      <tr key={category}>
        <th
          className={cn(
            stickyLabel,
            'border-b border-border/40 bg-canvas text-xs font-semibold text-content-muted',
          )}
          scope="row"
        >
          <span className="flex items-center gap-1.5">
            <CategoryIcon category={category} className="size-3.5 flex-none text-content-faint" />
            {categoryLabel[category]}
          </span>
        </th>
        {players.map((player, index) => (
          <ScoreCell
            key={player.playerId}
            strong={index === 0}
            value={player.scoreboard?.categories[category] ?? null}
          />
        ))}
      </tr>
    ))

  return (
    <section
      aria-label="플레이어별 족보 점수"
      className={cn('overflow-auto', className)}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤 영역은 포커스를 받아야 한다
      tabIndex={0}
    >
      <table className="w-full min-w-max border-collapse">
        <caption className="sr-only">플레이어별 족보 점수</caption>
        <thead>
          <tr>
            <th
              className={cn(
                stickyLabel,
                'border-b-2 border-border bg-canvas text-2xs font-bold text-content-muted',
              )}
              scope="col"
            >
              족보
            </th>
            {players.map((player, index) => (
              <th
                className={cn(
                  'min-w-14 border-b-2 border-border bg-canvas px-1 py-2.5 text-center text-2xs font-bold',
                  index === 0 ? 'text-content' : 'text-content-muted',
                )}
                key={player.playerId}
                scope="col"
              >
                <span className="block max-w-20 truncate">{player.nickname}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderRows(YACHT_UPPER_CATEGORIES)}
          <tr>
            <th
              className={cn(
                stickyLabel,
                'border-b border-border bg-surface-sunken text-2xs font-bold text-content-muted',
              )}
              scope="row"
            >
              보너스 /{UPPER_BONUS_THRESHOLD}
            </th>
            {players.map((player) => {
              const achieved = (player.scoreboard?.upperBonus ?? 0) > 0
              return (
                <td
                  className={cn(
                    'border-b border-border bg-surface-sunken px-1 py-2 text-center font-mono text-2xs font-bold tabular-nums',
                    achieved ? 'text-brand-strong' : 'text-content-muted',
                  )}
                  key={player.playerId}
                >
                  {player.scoreboard?.upperSubtotal ?? 0}
                  {achieved ? ` +${UPPER_BONUS_POINTS}` : ''}
                </td>
              )
            })}
          </tr>
          {renderRows(YACHT_LOWER_CATEGORIES)}
        </tbody>
        <tfoot>
          <tr>
            <th className={cn(stickyLabel, 'bg-brand text-xs font-bold text-on-brand')} scope="row">
              합계
            </th>
            {players.map((player) => (
              <td
                className="bg-brand px-1 py-3 text-center font-mono text-sm font-bold text-on-brand tabular-nums"
                key={player.playerId}
              >
                {player.scoreboard?.total ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </section>
  )
}

function ScoreCell({ strong, value }: { strong: boolean; value: number | null }): ReactNode {
  return (
    <td
      className={cn(
        'border-b border-l border-border/40 px-1 py-2.5 text-center font-mono text-xs tabular-nums',
        value === null && 'text-content-faint',
        value === 0 && 'text-danger',
        value !== null && value > 0 && (strong ? 'font-bold text-content' : 'text-content-muted'),
      )}
    >
      {value ?? '—'}
    </td>
  )
}
