import { cn } from '@/cn'
import type { CategoryScores, YachtCategory } from '@/domain/scoring'
import { YACHT_CATEGORIES } from '@/domain/scoring'
import { categoryLabel, categoryRowState, isRecorded } from '@/yachtCategoryView'
import { Button } from './Button'
import { ScoreRow } from './ScoreRow'

interface CategorySheetProps {
  /** 현재 주사위로 얻을 수 있는 점수. 주사위를 굴리기 전이면 비어 있다. */
  candidates: CategoryScores
  onConfirm: () => void
  onSelect: (category: YachtCategory) => void
  /** 서버가 확정한 내 점수판. null = 미기입. */
  recorded: Partial<Record<YachtCategory, number | null>>
  selectedCategory: YachtCategory | null
  disabled?: boolean
  submitting?: boolean
  total: number
}

/** 4상태 범례. 색 말고 형태로 구분된다는 걸 화면에서도 알려준다. */
const legend = [
  { className: 'border border-border', label: '사용 가능' },
  { className: 'border-2 border-brand', label: '선택됨' },
  { className: '[background-image:var(--ds-hatch-used)]', label: '사용 완료' },
  { className: 'border border-dashed border-danger', label: '0점 처리' },
]

export function CategorySheet({
  candidates,
  onConfirm,
  onSelect,
  recorded,
  selectedCategory,
  disabled = false,
  submitting = false,
  total,
}: CategorySheetProps) {
  const selectedScore = selectedCategory ? (candidates[selectedCategory] ?? 0) : null

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-bold text-content">족보 선택</h2>
        <p className="m-0 text-[11.5px] text-content-muted">
          현재 합계{' '}
          <strong className="font-mono font-bold text-content tabular-nums">{total}</strong>점
        </p>
      </div>

      <ul className="my-2.5 flex list-none flex-wrap gap-3 p-0 text-[10px] font-medium text-content-muted">
        {legend.map((item) => (
          <li className="flex items-center gap-1.5" key={item.label}>
            <span aria-hidden="true" className={cn('size-3 rounded-[3px]', item.className)} />
            {item.label}
          </li>
        ))}
      </ul>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto pb-2">
        {YACHT_CATEGORIES.map((category) => {
          const recordedScore = recorded[category]
          const state = categoryRowState(recordedScore, selectedCategory === category)
          return (
            <ScoreRow
              key={category}
              label={categoryLabel[category]}
              {...(!disabled ? { onSelect: () => onSelect(category) } : {})}
              score={isRecorded(recordedScore) ? recordedScore : candidates[category]}
              state={state}
            />
          )
        })}
      </div>

      <div className="mt-auto grid gap-2 pt-3">
        <Button
          disabled={disabled || selectedCategory === null}
          loading={submitting}
          onClick={onConfirm}
          size="lg"
        >
          {selectedCategory
            ? `${categoryLabel[selectedCategory]}에 ${selectedScore}점 확정`
            : '기록할 족보를 고르세요'}
        </Button>
      </div>
    </>
  )
}
