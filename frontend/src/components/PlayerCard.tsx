import { cn } from '@/cn'

type PlayerCardProps = {
  name: string
  score?: number
  status?: 'online' | 'away' | 'offline'
  isHost?: boolean
  active?: boolean
  className?: string
}
const statusLabel = {
  online: '온라인',
  away: '자리 비움',
  offline: '연결 끊김',
}

export function PlayerCard({
  active = false,
  className,
  isHost = false,
  name,
  score,
  status = 'online',
}: PlayerCardProps) {
  const stateLabel = `${isHost ? '방장, ' : ''}${statusLabel[status]}`

  return (
    <article
      className={cn(
        'grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-border bg-surface p-3',
        active && 'border-brand ring-1 ring-brand',
        status === 'offline' && 'opacity-60',
        className,
      )}
      aria-label={`${name}, ${stateLabel}${score === undefined ? '' : `, ${score}점`}`}
    >
      <span
        className="grid size-11 place-items-center rounded-full bg-brand font-bold text-on-brand"
        aria-hidden="true"
      >
        {name.slice(0, 1)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{name}</span>
        <span className="text-sm text-content-muted">{stateLabel}</span>
      </span>
      {score !== undefined && <strong className="font-bold tabular-nums">{score}</strong>}
    </article>
  )
}
