import { cn } from '@/shared/cn'
import { IconCheck } from '@/shared/components/Icon'
import type { ScoreRowState } from '@/yacht/domain/yachtCategoryView'

type ScoreRowProps = {
  className?: string
  label: string
  onSelect?: (() => void) | undefined
  score?: number | undefined
  size?: 'md' | 'sm'
  state?: ScoreRowState
}

const states: Record<ScoreRowState, string> = {
  available: 'border border-border bg-surface text-content',
  selected: 'border-2 border-brand bg-surface-raised text-content',
  used: 'border border-transparent text-content-faint [background-image:var(--ds-hatch-used)]',
  zeroed: 'border border-dashed border-danger bg-surface text-danger',
}

const sizes = {
  md: 'min-h-tap px-3 text-xs',
  sm: 'min-h-[2.375rem] px-3 text-xs',
} as const

export function ScoreRow({
  className,
  label,
  onSelect,
  score,
  size = 'md',
  state = 'available',
}: ScoreRowProps) {
  const used = state === 'used' || state === 'zeroed'
  const suffix =
    state === 'used'
      ? ' · 사용됨'
      : state === 'zeroed'
        ? ' · 0점으로 사용됨'
        : state === 'selected'
          ? ' 선택'
          : ''
  const rowClassName = cn(
    'flex w-full items-center justify-between gap-3 rounded-control text-left transition-colors duration-150 ease-snappy',
    states[state],
    sizes[size],
    onSelect &&
      !used &&
      'cursor-pointer hover:border-brand focus-ring focus-visible:outline-offset-2',
    className,
  )

  const content = (
    <>
      <span
        className={cn('min-w-0 truncate', state === 'selected' ? 'font-bold' : 'font-semibold')}
      >
        {label}
        {state === 'selected' ? (
          <>
            <IconCheck className="mx-1 inline size-3.5 align-middle" />
            선택
          </>
        ) : (
          suffix
        )}
      </span>
      <span className="flex-none font-mono font-bold tabular-nums">{score ?? '—'}</span>
    </>
  )

  if (!onSelect) return <div className={rowClassName}>{content}</div>

  return (
    <button
      aria-disabled={used || undefined}
      aria-label={`${label} ${score ?? '미정'}${suffix}`}
      aria-pressed={state === 'selected'}
      className={rowClassName}
      disabled={used}
      onClick={onSelect}
      type="button"
    >
      {content}
    </button>
  )
}
