import type { CSSProperties } from 'react'
import type { Player } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'
import { DRIFTS, LIFTS, REACTIONS } from '@/yacht/domain/reactions'
import { useReactionDock } from '@/yacht/model/useReactionDock'

interface ReactionDockProps {
  className?: string
  players: Player[]
}

export function ReactionDock({ className, players }: ReactionDockProps) {
  const {
    chipsRef,
    close,
    dockRef,
    flying,
    focusedChip,
    handleChipKeyDown,
    open,
    pickerId,
    send,
    setOpen,
    triggerRef,
  } = useReactionDock(players)

  const latest = flying.at(-1)

  return (
    <div className={cn('relative flex-none', className)} ref={dockRef}>
      <p aria-live="polite" className="sr-only" role="status">
        {latest ? `${latest.nickname} ${latest.label}` : ''}
      </p>

      {flying.map((item) => (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-full flex w-tap translate-x-(--drift) translate-y-(--lift) flex-col items-end gap-1 animate-reaction-float motion-reduce:animate-none"
          key={item.id}
          style={
            {
              '--drift': DRIFTS[item.id % DRIFTS.length],
              '--lift': LIFTS[item.id % LIFTS.length],
            } as CSSProperties
          }
        >
          <span className="text-3xl leading-none drop-shadow-[0_2px_10px_rgb(0_0_0_/_60%)]">
            {item.emoji}
          </span>
          {item.nickname && (
            <span className="max-w-24 truncate rounded-full bg-surface-overlay/90 px-1.5 py-px text-2xs font-semibold whitespace-nowrap text-content-muted">
              {item.nickname}
            </span>
          )}
        </span>
      ))}

      <div
        aria-label="리액션 고르기"
        aria-orientation="horizontal"
        className={cn(
          'absolute top-1/2 right-full mr-2 flex -translate-y-1/2 gap-1 rounded-panel border border-border bg-surface-overlay/95 p-1 shadow-raised transition-all duration-(--ds-motion-fast) ease-snappy',
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
        )}
        id={pickerId}
        onKeyDown={handleChipKeyDown}
        role="toolbar"
        style={{ transformOrigin: 'right center' }}
      >
        {REACTIONS.map((reaction, index) => (
          <button
            aria-label={reaction.label}
            className="reaction-chip focus-ring active:scale-90"
            key={reaction.type}
            onClick={() => send(reaction.type)}
            ref={(element) => {
              chipsRef.current[index] = element
            }}
            tabIndex={open && index === focusedChip ? 0 : -1}
            type="button"
          >
            {reaction.emoji}
          </button>
        ))}
      </div>

      {/* 글리프가 말풍선이 아니라 웃는 얼굴인 이유: 같은 화면의 채팅 버튼이 말풍선을 쓴다. */}
      <button
        aria-controls={pickerId}
        aria-expanded={open}
        aria-label="리액션 보내기"
        className={cn(
          'grid size-tap cursor-pointer place-items-center rounded-card border border-border bg-surface/90 text-lg shadow-raised transition-colors focus-ring pressable',
          open && 'border-brand bg-brand/15',
        )}
        onClick={() => (open ? close(false) : setOpen(true))}
        ref={triggerRef}
        type="button"
      >
        😀
      </button>
    </div>
  )
}
