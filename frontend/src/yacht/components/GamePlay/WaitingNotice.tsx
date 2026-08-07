import { IconCheck } from '@/shared/components/Icon'
import type { CategoryScores } from '@/yacht/domain/scoring'

export interface TurnProgress {
  rolled: boolean
  keptValues: number[]
  rolling: boolean
  submitted: boolean
  rollCount: number
  candidates: CategoryScores
  motionNoticeVisible: boolean
  wide: boolean
}

export function WaitingNotice({
  activePlayerName,
  submitted,
}: {
  activePlayerName: string | undefined
  submitted: boolean
}) {
  if (submitted) {
    return (
      <p className="m-0 flex min-h-15 flex-1 items-center justify-center gap-2.5 rounded-panel border border-positive/40 bg-positive/10 px-4 text-center text-sm font-semibold text-positive">
        <span
          aria-hidden="true"
          className="grid size-5 flex-none place-items-center rounded-chip bg-positive/20"
        >
          <IconCheck className="size-3" />
        </span>
        점수가 반영됐습니다. 다음 턴을 기다립니다.
      </p>
    )
  }

  return (
    <p className="m-0 flex min-h-15 flex-1 items-center justify-center gap-2.5 rounded-panel border border-border bg-surface px-4 text-center text-sm font-semibold text-content-muted">
      <span
        aria-hidden="true"
        className="size-2 flex-none rounded-xs bg-brand-strong motion-safe:animate-ring-pulse"
      />
      {activePlayerName ? `${activePlayerName}(이)가 굴리는 중` : '턴 동기화 중'}
    </p>
  )
}
