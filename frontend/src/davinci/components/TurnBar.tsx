import { cn } from '@/shared/cn'

interface TurnBarProps {
  deckCount: number
  message: string | null
  mine: boolean
  secondsLeft: number
  turnName: string
}

const URGENT_SECONDS = 5

/** 화면 맨 위 한 줄 — 지금 누구 차례이고, 몇 초 남았고, 더미가 몇 장인가. */
export function TurnBar({ deckCount, message, mine, secondsLeft, turnName }: TurnBarProps) {
  return (
    <header className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            'm-0 truncate font-bold text-base',
            mine ? 'text-dv-turn' : 'text-game-content',
          )}
        >
          {mine ? '내 차례' : `${turnName}의 차례`}
        </p>
        <div className="flex shrink-0 items-center gap-3 font-mono text-2xs uppercase tracking-[0.18em]">
          <span className="text-game-content-faint">더미 {deckCount}</span>
          {secondsLeft > 0 && (
            <span
              className={cn(
                'tabular-nums',
                secondsLeft <= URGENT_SECONDS ? 'text-dv-accent' : 'text-game-content-muted',
              )}
            >
              {secondsLeft}s
            </span>
          )}
        </div>
      </div>
      {message !== null && (
        <p className="m-0 truncate text-game-content-muted text-sm" role="status">
          {message}
        </p>
      )}
    </header>
  )
}
