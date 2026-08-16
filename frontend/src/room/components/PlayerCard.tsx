import type { ReactNode } from 'react'
import { cn } from '@/shared/cn'
import { Badge } from '@/shared/components/Badge'

type PlayerCardProps = {
  name: string
  avatarSeed?: string
  score?: number
  status?: 'online' | 'away' | 'offline'
  active?: boolean
  current?: boolean
  subtitle?: string | undefined
  trailing?: ReactNode | undefined
  speaking?: boolean
  nameEnd?: ReactNode
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
  'bg-warning text-canvas',
] as const

export function PlayerCard({
  active = false,
  className,
  current = false,
  name,
  avatarSeed = name,
  nameEnd,
  score,
  speaking = false,
  status = 'online',
  subtitle,
  trailing,
}: PlayerCardProps) {
  const stateLabel = subtitle ?? statusLabel[status]
  const avatarTone = avatarTones[hashString(avatarSeed) % avatarTones.length]

  return (
    <article
      className={cn(
        'grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-panel border border-border bg-surface-raised p-3',
        active && 'border-border-strong',
        status === 'offline' && 'opacity-60',
        speaking && 'outline-2 outline-positive outline-offset-1',
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
            <span className="shrink-0 rounded-chip bg-content px-2 py-0.5 text-xs font-bold text-canvas">
              나
            </span>
          )}
          {nameEnd && <span className="ml-auto shrink-0">{nameEnd}</span>}
        </span>
        {status === 'offline' && !subtitle ? (
          <Badge className="mt-1 text-xs" tone="warning">
            {stateLabel}
          </Badge>
        ) : (
          <span className="text-sm text-content-muted">{stateLabel}</span>
        )}
      </span>
      {trailing ??
        (score !== undefined && <strong className="font-bold tabular-nums">{score}</strong>)}
    </article>
  )
}

function hashString(value: string) {
  let hash = 0
  for (const character of value) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  return hash
}
