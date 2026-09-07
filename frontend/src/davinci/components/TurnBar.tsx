import { type Seat, TurnOrder } from '@/davinci/components/TurnOrder'
import { phaseLabel } from '@/davinci/domain/davinci'
import type { DavinciPhase } from '@/realtime/wsEvents'
import { cn } from '@/shared/cn'

interface TurnBarProps {
  deckCount: number
  message: string | null
  mine: boolean
  phase: DavinciPhase
  seats: readonly Seat[]
  secondsLeft: number
  turnName: string
}

const URGENT_SECONDS = 5

/**
 * 화면 맨 위 상태판 — 지금 누구 차례이고, 어느 단계이고, 몇 초 남았고, 차례가 어느
 * 순서로 도는가.
 *
 * 차례는 글자 한 줄로 두지 않고 **카드째로 색을 바꾼다**(내 차례면 금색 테두리와 바탕).
 * 손패 줄의 테두리만 바꿨을 때는 2인 판에서 두 줄의 색 차이를 견주어야 내 차례인지
 * 알 수 있었고, 상대 차례에는 화면 어디에도 "기다리라"는 신호가 크지 않아 사람이 판이
 * 멈춘 줄 알고 타일을 눌렀다(서버는 그 입력을 조용히 무시한다).
 */
export function TurnBar({
  deckCount,
  message,
  mine,
  phase,
  seats,
  secondsLeft,
  turnName,
}: TurnBarProps) {
  return (
    <header className="grid gap-2">
      <div
        className={cn(
          'grid gap-1.5 rounded-card border px-3 py-2.5 transition-colors',
          mine ? 'border-dv-turn/70 bg-dv-turn/10' : 'border-dv-line bg-dv-surface',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className={cn(
              'm-0 flex min-w-0 items-center gap-2 font-black text-lg',
              mine ? 'text-dv-turn' : 'text-game-content',
            )}
            role="status"
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                mine ? 'bg-dv-turn motion-safe:animate-pulse' : 'bg-game-content-faint',
              )}
            />
            <span className="truncate">{mine ? '내 차례' : `${turnName}의 차례`}</span>
          </p>
          {secondsLeft > 0 && (
            <span
              className={cn(
                'shrink-0 font-black font-mono text-xl tabular-nums',
                secondsLeft <= URGENT_SECONDS ? 'text-dv-accent' : 'text-game-content',
              )}
            >
              {secondsLeft}s
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 font-bold text-2xs',
              mine ? 'border-dv-turn/50 text-dv-turn' : 'border-dv-line text-game-content-muted',
            )}
          >
            {phaseLabel(phase)}
          </span>
          <span className="font-mono text-2xs text-game-content-faint uppercase tracking-[0.18em]">
            더미 {deckCount}
          </span>
        </div>
      </div>

      <TurnOrder seats={seats} />

      {/* 자르지 않는다 — 무엇을 불러서 맞았는지가 이 게임에서 가장 중요한 한 줄이라,
          잘리면 판을 되짚을 수 없다. 길면 두 줄로 흐른다. */}
      {message !== null && (
        <p className="m-0 text-balance text-game-content-muted text-sm" role="status">
          {message}
        </p>
      )}
    </header>
  )
}
