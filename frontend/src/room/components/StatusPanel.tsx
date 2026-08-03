import { cn } from '@/shared/cn'

type StatusPanelProps = {
  variant: 'loading' | 'empty' | 'error' | 'reconnect'
  title?: string
  description?: string
  className?: string
}
const defaults = {
  loading: ['불러오는 중', '잠시만 기다려 주세요.'],
  empty: ['아직 내용이 없어요', '새 항목이 생기면 여기에 표시됩니다.'],
  error: ['문제가 발생했어요', '잠시 후 다시 시도해 주세요.'],
  reconnect: ['다시 연결하는 중', '최신 게임 상태를 복구하고 있습니다.'],
} as const

const titleColors = {
  loading: 'text-content',
  empty: 'text-content',
  error: 'text-danger',
  reconnect: 'text-brand-strong',
} as const

export function StatusPanel({ className, description, title, variant }: StatusPanelProps) {
  const [defaultTitle, defaultDescription] = defaults[variant]
  return (
    <section
      className={cn(
        'grid min-h-32 place-items-center gap-2 rounded-card border border-dashed border-border p-6 text-center text-content-muted',
        className,
      )}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {variant === 'loading' && (
        <span
          className="size-8 animate-spin-slow rounded-full border-3 border-border border-t-brand motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      <strong className={titleColors[variant]}>{title ?? defaultTitle}</strong>
      <span>{description ?? defaultDescription}</span>
    </section>
  )
}
