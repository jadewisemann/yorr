import { useState } from 'react'
import type { MotionGestureEvent } from '@/input/motionTypes'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import { copyTextToClipboard } from './motionLabClipboard'
import type { LabEvent } from './useMotionLab'

interface MotionLabEventLogProps {
  events: LabEvent[]
  onClear: () => void
}

const EVENT_STYLE: Record<MotionGestureEvent['type'], string> = {
  throwDetected: 'border-brand bg-brand/15 text-brand-strong font-bold',
  shakeStarted: 'border-positive/60 text-content',
  shakeArmed: 'border-positive/60 text-content',
  shakePulse: 'border-border text-content-muted',
  gestureCancelled: 'border-border text-content-faint',
}

function describe(event: MotionGestureEvent) {
  switch (event.type) {
    case 'shakePulse':
      return `${event.direction === 'left' ? '←' : '→'} 강도 ${event.strength.toFixed(2)}`
    case 'throwDetected':
      return `확신도 ${event.confidence.toFixed(2)}`
    case 'gestureCancelled':
      return event.reason
    default:
      return ''
  }
}

function formatClock(wallClock: number) {
  return new Date(wallClock).toLocaleTimeString('ko-KR', { hour12: false })
}

export function MotionLabEventLog({ events, onClear }: MotionLabEventLogProps) {
  const [message, setMessage] = useState<string | null>(null)

  const copyAll = async () => {
    const ok = await copyTextToClipboard(
      JSON.stringify(
        events.map((entry) => entry.event),
        null,
        2,
      ),
    )
    setMessage(
      ok ? '이벤트 로그를 복사했어요.' : '복사에 실패했어요. 브라우저 권한을 확인해 주세요.',
    )
  }

  return (
    <section className="grid gap-3 rounded-panel border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-xl font-bold">이벤트 로그</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={events.length === 0} onClick={onClear}>
            지우기
          </Button>
          <Button size="sm" variant="secondary" disabled={events.length === 0} onClick={copyAll}>
            JSON 복사
          </Button>
        </div>
      </div>
      {message && (
        <p className="m-0 text-sm text-content-muted" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {events.length === 0 ? (
        <p className="m-0 text-sm text-content-muted">
          아직 이벤트가 없어요. 센서를 시작하고 기기를 흔들어 보세요.
        </p>
      ) : (
        <ol className="m-0 grid max-h-72 list-none gap-1.5 overflow-y-auto p-0">
          {events.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                'flex items-baseline justify-between gap-2 rounded-card border px-3 py-1.5 text-sm',
                EVENT_STYLE[entry.event.type],
              )}
            >
              <span>
                {entry.event.type}
                <span className="ml-2 text-xs opacity-80">{describe(entry.event)}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums opacity-70">
                {formatClock(entry.wallClock)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
