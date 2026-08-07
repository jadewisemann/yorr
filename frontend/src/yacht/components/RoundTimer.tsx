import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/cn'
import { formatCountdown, TIMER_WARNING_MS } from '@/yacht/model/useCountdown'

interface RoundTimerProps {
  className?: string
  compact?: boolean
  remainingMs: number
  roundNumber: number
  totalRounds: number
}

export function RoundTimer({
  className,
  compact = false,
  remainingMs,
  roundNumber,
  totalRounds,
}: RoundTimerProps) {
  const warning = remainingMs <= TIMER_WARNING_MS && remainingMs > 0
  const ratio = useRoundRatio(roundNumber, remainingMs)
  const warningNotice = useWarningNotice(roundNumber, warning)

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {!compact && (
        <span className="flex-none rounded-control border border-border px-3 py-1.5 text-xs font-bold text-content">
          라운드 {roundNumber}/{totalRounds}
        </span>
      )}
      <div
        className={cn(
          'grid size-13 flex-none place-items-center rounded-full',
          warning &&
            'shadow-[0_0_18px_rgb(229_57_53_/_28%)] motion-safe:animate-ring-pulse motion-reduce:animate-none',
        )}
        style={{
          background: `conic-gradient(${warning ? 'var(--ds-color-brand)' : 'var(--ds-color-content)'} ${ratio}turn, rgb(255 255 255 / 12%) ${ratio}turn 1turn)`,
        }}
      >
        <span
          aria-label="남은 시간"
          className={cn(
            'grid size-[2.7rem] place-items-center rounded-full bg-canvas font-mono text-sm tabular-nums transition-colors',
            warning ? 'font-bold text-brand-strong' : 'font-medium text-content',
          )}
          role="timer"
        >
          {formatCountdown(remainingMs)}
        </span>
      </div>
      <p aria-live="assertive" className="sr-only">
        {warningNotice}
      </p>
    </div>
  )
}

function useRoundRatio(roundNumber: number, remainingMs: number) {
  const durationRef = useRef({ roundNumber, durationMs: remainingMs })

  if (durationRef.current.roundNumber !== roundNumber) {
    durationRef.current = { roundNumber, durationMs: remainingMs }
  } else if (remainingMs > durationRef.current.durationMs) {
    durationRef.current.durationMs = remainingMs
  }

  const { durationMs } = durationRef.current
  if (durationMs <= 0) return 1
  return Math.min(1, remainingMs / durationMs)
}

function useWarningNotice(roundNumber: number, warning: boolean) {
  const [notice, setNotice] = useState('')
  const announcedRoundRef = useRef<number | null>(null)

  useEffect(() => {
    if (!warning) {
      setNotice('')
      return
    }
    if (announcedRoundRef.current === roundNumber) return
    announcedRoundRef.current = roundNumber
    setNotice('10초 남았습니다')
  }, [roundNumber, warning])

  return notice
}
