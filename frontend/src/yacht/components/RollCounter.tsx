import { cn } from '@/shared/cn'

interface RollCounterProps {
  className?: string
  maxRolls?: number
  rollsUsed: number
}

export function RollCounter({ className, maxRolls = 3, rollsUsed }: RollCounterProps) {
  const remaining = Math.max(0, maxRolls - rollsUsed)

  return (
    <div
      className={cn(
        'inline-flex flex-none items-center gap-2 rounded-card border border-border-raised bg-surface-raised/92 px-3 py-1.5',
        className,
      )}
    >
      <DieFace value={remaining} />
      <p
        className={cn(
          'm-0 text-sm font-bold whitespace-nowrap tabular-nums',
          remaining > 0 ? 'text-content' : 'text-content-muted',
        )}
      >
        {remaining > 0 ? `${remaining}회 남음` : '굴림 소진'}
      </p>
    </div>
  )
}

function DieFace({ value }: { value: number }) {
  const pipsByValue: Record<number, Array<[number, number]>> = {
    1: [[8, 8]],
    2: [
      [5, 5],
      [11, 11],
    ],
    3: [
      [4.5, 4.5],
      [8, 8],
      [11.5, 11.5],
    ],
  }
  const pips = pipsByValue[value] ?? []

  return (
    <svg aria-hidden="true" className="size-5 flex-none" viewBox="0 0 16 16">
      <rect
        className={value > 0 ? 'fill-content' : 'fill-transparent stroke-white/35'}
        height="14.5"
        rx="3.5"
        strokeWidth="1.5"
        width="14.5"
        x="0.75"
        y="0.75"
      />
      {pips.map(([cx, cy]) => (
        <circle className="fill-canvas" cx={cx} cy={cy} key={`${cx}-${cy}`} r="1.7" />
      ))}
    </svg>
  )
}
