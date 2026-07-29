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
 * 상단 단일 앵커 타이머. 라운드·남은 시간·진행 바를 한 덩어리로 묶어
 * "1초 판단"이 되도록 한다(와이어프레임 1a 개선 ①).
 *
 * 점멸은 쓰지 않는다 — 임박은 색 전환과 숫자 굵기로만 알린다.
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
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10.5px] font-medium tracking-[0.08em] text-content-faint uppercase">
            남은 시간
          </span>
          <span
            aria-label="남은 시간"
            className={cn(
              'font-mono text-xl tabular-nums transition-colors',
              warning ? 'font-bold text-danger' : 'font-medium text-content',
            )}
            role="timer"
          >
            {formatCountdown(remainingMs)}
          </span>
        </div>
        <div className="mt-1 h-[7px] overflow-hidden rounded-full bg-surface-sunken">
          {/* width 대신 scaleX로 줄인다 — 레이아웃을 건드리지 않고 합성만으로 처리된다. */}
          <div
            className={cn(
              'h-full origin-left transition-[transform,background-color] duration-1000 ease-linear',
              warning ? 'bg-danger' : 'bg-brand',
            )}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
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
