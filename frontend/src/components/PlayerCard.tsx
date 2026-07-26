import { cn } from '@/cn'

type PlayerCardProps = {
  name: string
  avatarSeed?: string
  score?: number
  status?: 'online' | 'away' | 'offline'
  active?: boolean
  current?: boolean
  className?: string
}
const statusLabel = {
  online: '온라인',
  away: '자리 비움',
  offline: '연결 끊김',
}

const avatarTones = [
  'bg-brand text-on-brand',
  'bg-positive text-canvas',
  'bg-focus text-canvas',
  'bg-brand-strong text-on-brand',
] as const

export function PlayerCard({
  active = false,
  className,
  current = false,
  name,
  avatarSeed = name,
  score,
  status = 'online',
}: PlayerCardProps) {
  const stateLabel = statusLabel[status]
  const avatarTone = avatarTones[hashString(avatarSeed) % avatarTones.length]

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
        className={cn('grid size-11 place-items-center rounded-full font-bold', avatarTone)}
        aria-hidden="true"
      >
        {name.slice(0, 1)}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-bold">{name}</span>
          {current && (
            <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-on-brand">
              나
            </span>
          )}
        </span>
        <span className="text-sm text-content-muted">{stateLabel}</span>
      </span>
      {score !== undefined && <strong className="font-bold tabular-nums">{score}</strong>}
    </article>
  )
}

function hashString(value: string) {
  let hash = 0
  for (const character of value) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return hash
}
