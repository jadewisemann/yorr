import { useEffect, useRef, useState } from 'react'
import { cn } from '@/cn'
import { formatCountdown, TIMER_WARNING_MS } from '@/useCountdown'

interface RoundTimerProps {
  className?: string
  /** 라운드 pill을 숨기고 타이머만 노출한다(점수표 탭처럼 좁은 헤더에서). */
  compact?: boolean
  remainingMs: number
  roundNumber: number
  totalRounds: number
}

/**
 * 원형 링 타이머(디자인 시스템 05) — conic-gradient가 남은 비율만큼 차 있다.
 * 임박(5초 이하 경고 구간)은 링·숫자가 레드로 바뀌고 은은한 글로우가 붙는다.
 * 점멸 대신 펄스 스케일만 쓰고, 모션 감소 설정에서는 색 전환만 남긴다.
 */
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
            'grid size-[2.7rem] place-items-center rounded-full bg-canvas font-mono text-[15px] tabular-nums transition-colors',
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

/**
 * 서버 계약은 deadline만 주고 라운드 총 길이는 주지 않는다.
 * 이번 라운드에서 관측한 최댓값을 100%로 잡으면 바가 단조 감소하고 0에서 정확히 비어진다.
 */
function useRoundRatio(roundNumber: number, remainingMs: number) {
  const durationRef = useRef({ roundNumber, durationMs: remainingMs })

  if (durationRef.current.roundNumber !== roundNumber) {
    durationRef.current = { roundNumber, durationMs: remainingMs }
  } else if (remainingMs > durationRef.current.durationMs) {
    durationRef.current.durationMs = remainingMs
  }

  const { durationMs } = durationRef.current
  // 라운드가 막 바뀐 프레임에는 새 deadline이 아직 안 반영돼 durationMs가 0이다.
  // 그때 0%로 떨어뜨리면 바가 한 프레임 비었다가 차오른다 — 가득 찬 상태로 시작한다.
  if (durationMs <= 0) return 1
  return Math.min(1, remainingMs / durationMs)
}

/** 임박 안내는 라운드당 한 번만 읽는다. 매 tick 읽으면 스크린리더가 막힌다. */
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
