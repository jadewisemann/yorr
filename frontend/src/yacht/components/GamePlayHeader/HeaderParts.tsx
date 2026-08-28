import type { Ref } from 'react'
import { cn } from '@/shared/cn'
import type { ConnectionStatus } from '@/store'

export function HeaderButton({
  children,
  label,
  onClick,
  pressed,
  ref,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  pressed?: boolean
  ref?: Ref<HTMLButtonElement> | undefined
}) {
  return (
    <button
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className="relative grid size-tap flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-content-muted transition-colors hover:text-content focus-ring pressable"
      onClick={onClick}
      ref={ref}
      type="button"
    >
      {children}
    </button>
  )
}

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const connected = status === 'connected'
  const label = {
    closed: '연결 끊김',
    connected: '연결됨',
    connecting: '연결 중',
    idle: '연결 중',
    reconnecting: '재연결 중',
  }[status]

  return (
    <span className="inline-flex h-[2.125rem] flex-none items-center gap-2 rounded-full border border-border bg-surface-veil px-3.5 text-xs font-semibold">
      <span
        aria-hidden="true"
        className={cn('size-[7px] rounded-full', connected ? 'bg-positive' : 'bg-warning')}
      />
      {label}
    </span>
  )
}

export function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-2xs font-medium tracking-[0.08em] text-content-faint uppercase">
        {label}
      </span>
      <span className="text-base font-bold text-content">{value}</span>
    </div>
  )
}
