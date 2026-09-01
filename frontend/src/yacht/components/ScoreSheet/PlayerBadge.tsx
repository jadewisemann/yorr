import { cn } from '@/shared/cn'
import { isRecorded } from '@/yacht/domain/yachtCategoryView'

export function scoreCell(
  value: number | null | undefined,
  preview: number | null,
  isPreview: boolean,
) {
  if (isPreview) return { className: 'bg-brand/15 text-brand-strong', content: preview }
  if (!isRecorded(value)) return { className: 'text-content-faint', content: '·' }
  return { className: value === 0 ? 'text-danger' : 'text-content', content: value }
}

export function PlayerBadge({
  active = false,
  nickname,
  size = 'md',
}: {
  active?: boolean
  nickname: string
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border font-bold',
        size === 'md' ? 'size-7 text-2xs' : 'size-6 text-2xs',
        active
          ? 'border-brand bg-brand text-on-brand'
          : 'border-border bg-surface text-content-muted',
      )}
      title={nickname}
    >
      {initialsOf(nickname)}
    </span>
  )
}

function initialsOf(nickname: string) {
  if (/[가-힣]/.test(nickname)) return nickname.slice(0, 2)
  const parts = nickname.split(/[\s'’-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? nickname[0] ?? '?'
  const second = parts[1]?.[0] ?? ''
  return `${first}${second}`.toUpperCase()
}
