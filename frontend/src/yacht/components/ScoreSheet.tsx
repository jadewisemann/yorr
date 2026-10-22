import type { ReactNode } from 'react'
import type { PlayerId } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { Tooltip } from '@/shared/components/Tooltip'
import { PlayerBadge, type ScoreSheetPlayer } from '@/yacht/components/ScoreSheet/PlayerBadge'
import { MetaRow, metaRowsOf, previewOf, ScoreRow } from '@/yacht/components/ScoreSheet/ScoreRow'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import {
  UPPER_BONUS_POINTS,
  UPPER_BONUS_THRESHOLD,
  YACHT_LOWER_CATEGORIES,
  YACHT_UPPER_CATEGORIES,
} from '@/yacht/domain/scoring'

export type { ScoreSheetPlayer } from '@/yacht/components/ScoreSheet/PlayerBadge'

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
 * 파일마다 복제된다. 행 렌더링 자체는 ScoreRow/MetaRow가 들고 있다.
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
  const meta = { ...metaRowsOf(players), bonusPoints: UPPER_BONUS_POINTS }
  const columns = {
    gridTemplateColumns: `minmax(8rem, 1.3fr) repeat(${players.length}, minmax(2.75rem, 1fr))`,
  }

  const renderCategoryRow = (category: YachtCategory) => {
    const preview = previewOf({ activePlayer, candidates, category, rolled })
    return (
      <ScoreRow
        activePlayerId={activePlayerId}
        category={category}
        clickable={activePlayerId === you && canPick && preview !== null}
        columns={columns}
        key={category}
        leverageCategory={leverageCategory}
        onPick={onPick}
        players={players}
        preview={preview}
      />
    )
  }

  const metaRow = (
    label: ReactNode,
    values: string[],
    options?: { achieved?: boolean[]; emphasis?: boolean },
  ) => (
    <MetaRow
      activePlayerId={activePlayerId}
      columns={columns}
      label={label}
      players={players}
      values={values}
      {...options}
    />
  )

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
      {metaRow(`소계 / ${UPPER_BONUS_THRESHOLD}`, meta.subtotal, {
        achieved: meta.subtotalAchieved,
      })}
      {metaRow(`보너스 +${meta.bonusPoints}`, meta.bonus, { achieved: meta.bonusAchieved })}
      {YACHT_LOWER_CATEGORIES.map(renderCategoryRow)}
      {metaRow('합계', meta.total, { emphasis: true })}
    </section>
  )
}
