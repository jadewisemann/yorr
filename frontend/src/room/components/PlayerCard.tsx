import type { ReactNode } from 'react'
import { cn } from '@/shared/cn'

type PlayerCardProps = {
  name: string
  avatarSeed?: string
  score?: number
  status?: 'online' | 'away' | 'offline'
  active?: boolean
  current?: boolean
  subtitle?: string | undefined
  trailing?: ReactNode | undefined
  /** 음성 채팅에서 지금 말하고 있는지. 통화를 끈 상태면 항상 false다. */
  speaking?: boolean
  /**
   * 이름표 오른쪽 끝에 붙는 슬롯. 지금은 그 사람의 마이크(PeerMicButton)가 온다.
   * 이 컴포넌트는 봇 카드에도 쓰이므로 음성을 직접 알지 않고 슬롯만 내준다.
   */
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
  'bg-brand-strong text-on-brand',
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
        active && 'border-white/18',
        status === 'offline' && 'opacity-60',
        // 말하는 중 — TurnStrip과 같은 신호(초록 outline + 🎙)를 쓴다. border는 active가
        // 이미 쓰고 있으므로 outline으로 두른다.
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
            <span className="shrink-0 rounded-[6px] bg-content px-2 py-0.5 text-xs font-bold text-canvas">
              나
            </span>
          )}
          {/* 이름표 오른쪽 끝. ml-auto로 밀어 카드마다 같은 자리에 세운다. */}
          {nameEnd && <span className="ml-auto shrink-0">{nameEnd}</span>}
        </span>
        {status === 'offline' && !subtitle ? (
          <span className="mt-1 inline-flex rounded-full border border-warning/40 bg-warning/12 px-2 py-0.5 text-xs font-bold text-warning">
            {stateLabel}
          </span>
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
