import { cn } from '../cn'

type ScoreRowProps = {
  label: string
  score?: number
  selected?: boolean
  disabled?: boolean
  onSelect?: () => void
  className?: string
}

export function ScoreRow({
  className,
  disabled,
  label,
  onSelect,
  score,
  selected = false,
}: ScoreRowProps) {
  const rowClassName = cn(
    'grid min-h-tap w-full grid-cols-[1fr_auto] items-center gap-4 rounded-control border border-border bg-surface px-4 py-3 text-left text-content',
    onSelect &&
      'cursor-pointer hover:not-disabled:border-brand focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    selected && 'border-brand bg-surface-raised',
    className,
  )
  const content = (
    <>
      <span>{label}</span>
      <span className="font-bold text-brand-strong tabular-nums">{score ?? '—'}</span>
    </>
  )
  return onSelect ? (
    <button
      className={rowClassName}
      type="button"
      disabled={disabled}
      aria-label={`${label} ${score ?? '미정'}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {content}
    </button>
  ) : (
    <div className={rowClassName}>{content}</div>
  )
}
