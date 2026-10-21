import { cn } from '@/shared/cn'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'
import { categoryLabel, categoryShortLabel } from '@/yacht/domain/yachtCategoryView'

export function QuickCategoryStrip({
  canPick,
  candidates,
  categories,
  leverageCategory,
  onPick,
  rolled,
}: {
  canPick: boolean
  candidates: CategoryScores
  categories: YachtCategory[]
  leverageCategory: YachtCategory | null
  onPick: (category: YachtCategory) => void
  rolled: boolean
}) {
  return (
    <ul
      className="m-0 flex list-none gap-2 overflow-x-auto px-4 py-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-tutorial="sheet"
    >
      {categories.map((category) => {
        const score = rolled ? (candidates[category] ?? 0) : null
        const scoreLabel = score === null ? '' : ` ${score}점 기록`
        const leveraged = category === leverageCategory
        return (
          <li className="flex-none" key={category}>
            <button
              aria-label={`${categoryLabel[category]}${leveraged ? ' 2배' : ''}${scoreLabel}`}
              className={cn('quick-chip focus-ring', leveraged && 'border-2 border-brand')}
              data-tutorial-category={category}
              disabled={!canPick || !rolled}
              onClick={() => onPick(category)}
              type="button"
            >
              <span className="flex items-center gap-1 text-2xs font-semibold tracking-[0.07em] uppercase">
                {categoryShortLabel[category]}
                {leveraged && <span className="text-brand-strong">×2</span>}
              </span>
              <span className="font-mono text-xl leading-none font-bold tabular-nums">
                {score ?? '—'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
