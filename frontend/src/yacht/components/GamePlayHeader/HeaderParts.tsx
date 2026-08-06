import type { Ref } from 'react'
import type { VoiceChat } from '@/realtime/voice/useVoiceChat'
import { cn } from '@/shared/cn'
import type { ConnectionStatus } from '@/store'

/** 시트를 열지 않고도 지금 상태가 읽히게 라벨에 소리·마이크를 함께 담는다. */
export function audioLabel(soundMuted: boolean, voice: VoiceChat) {
  const sound = soundMuted ? '소리 꺼짐' : '소리 켜짐'
  if (voice.status === 'on') {
    const peers = voice.peers.length
    return `오디오 설정 · ${sound} · 마이크 켜짐${peers > 0 ? ` · ${peers}명 연결됨` : ''}`
  }
  return `오디오 설정 · ${sound} · 마이크 꺼짐`
}

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
      className="grid size-tap flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-content-muted transition-colors hover:text-content focus-ring"
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
