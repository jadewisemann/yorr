import { cn } from '@/shared/cn'
import { IconCheck } from '@/shared/components/Icon'
import type { ScoreRowState } from '@/yacht/yachtCategoryView'

export type { ScoreRowState }

type ScoreRowProps = {
  className?: string
  label: string
  onSelect?: (() => void) | undefined
  score?: number | undefined
  /** md = 바텀시트 50px, sm = 웹 좌측 패널 38px */
  size?: 'md' | 'sm'
  state?: ScoreRowState
}

const states: Record<ScoreRowState, string> = {
  available: 'border border-border bg-surface text-content',
  selected: 'border-2 border-brand bg-surface-raised text-content',
  used: 'border border-transparent text-content-faint [background-image:var(--ds-hatch-used)]',
  zeroed: 'border border-dashed border-danger bg-surface text-danger',
}

const sizes = {
  md: 'min-h-tap px-3 text-[12px]',
  // sm은 웹 좌측 상시 패널 전용이다. 포인터가 정확한 환경이라 tap 타깃보다 조밀해도 된다.
  sm: 'min-h-[2.375rem] px-3 text-[12px]',
} as const

export function ScoreRow({
  className,
  label,
  onSelect,
  score,
  size = 'md',
  state = 'available',
}: ScoreRowProps) {
  // 0점으로 확정한 칸도 이미 쓴 칸이다. 다시 고를 수 없어야 한다.
  const used = state === 'used' || state === 'zeroed'
  // 0점 확정도 소진된 칸이다. 스크린리더에서 "사용 가능한데 지금 0점"과 구분돼야 한다.
  const suffix =
    state === 'used'
      ? ' · 사용됨'
      : state === 'zeroed'
        ? ' · 0점으로 사용됨'
        : state === 'selected'
          ? ' 선택'
          : ''
  const rowClassName = cn(
    'flex w-full items-center justify-between gap-3 rounded-control text-left transition-colors duration-150 ease-snappy',
    states[state],
    sizes[size],
    onSelect &&
      !used &&
      'cursor-pointer hover:border-brand focus-ring focus-visible:outline-offset-2',
    className,
  )

  const content = (
    <>
      <span
        className={cn('min-w-0 truncate', state === 'selected' ? 'font-bold' : 'font-semibold')}
      >
        {label}
        {/* 선택 표시만 아이콘이다. 아이콘은 aria-hidden이므로 접근 가능한 이름은 아래
            aria-label의 suffix 텍스트가 그대로 책임진다 — 이름에 있던 '✓'는 낭독에서
            "체크 표시"로 읽히는 노이즈였다. */}
        {state === 'selected' ? (
          <>
            <IconCheck className="mx-1 inline size-3.5 align-middle" />
            선택
          </>
        ) : (
          suffix
        )}
      </span>
      <span className="flex-none font-mono font-bold tabular-nums">{score ?? '—'}</span>
    </>
  )

  if (!onSelect) return <div className={rowClassName}>{content}</div>

  return (
    <button
      aria-disabled={used || undefined}
      aria-label={`${label} ${score ?? '미정'}${suffix}`}
      aria-pressed={state === 'selected'}
      className={rowClassName}
      disabled={used}
      onClick={onSelect}
      type="button"
    >
      {content}
    </button>
  )
}
