import { cn } from '@/shared/cn'
import type { ConnectionStatus } from '@/store'

interface ConnectionBannerProps {
  className?: string
  status: ConnectionStatus
}

const messages: Partial<Record<ConnectionStatus, { detail: string; title: string }>> = {
  connecting: { title: '연결하는 중…', detail: '잠시만 기다려 주세요.' },
  reconnecting: {
    title: '다시 연결하는 중…',
    detail: '현재 주사위와 점수는 서버에 저장돼 있습니다.',
  },
  closed: { title: '연결이 끊겼습니다', detail: '네트워크를 확인한 뒤 다시 시도해 주세요.' },
}

export function ConnectionBanner({ className, status }: ConnectionBannerProps) {
  const message = messages[status]

  return (
    <div
      aria-live={status === 'closed' ? 'assertive' : 'polite'}
      className={cn(
        message && 'flex items-center gap-2.5 border-b px-gutter py-2',
        status === 'connecting' && 'border-border bg-surface-veil',
        status === 'reconnecting' && 'border-warning/40 bg-warning/12',
        status === 'closed' && 'border-brand/42 bg-brand/12',
        className,
      )}
      role={status === 'closed' ? 'alert' : 'status'}
    >
      {message && (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'flex-none',
              status === 'closed'
                ? 'h-0.5 w-2.5 bg-danger'
                : status === 'reconnecting'
                  ? 'size-2 rounded-xs bg-warning'
                  : 'size-2.5 rounded-full border-2 border-content-muted',
            )}
          />
          <p
            className={cn(
              'm-0 min-w-0 text-xs font-bold',
              status === 'reconnecting'
                ? 'text-warning'
                : status === 'closed'
                  ? 'text-danger'
                  : 'text-content',
            )}
          >
            {message.title}
            <span className="ml-2 font-medium text-content-muted">{message.detail}</span>
          </p>
        </>
      )}
    </div>
  )
}
