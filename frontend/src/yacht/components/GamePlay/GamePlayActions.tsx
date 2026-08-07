import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'
import type { CategoryScores } from '@/yacht/domain/scoring'
import { WaitingNotice } from './WaitingNotice'

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

export function GamePlayActions({
  activePlayerName,
  canReleaseAll,
  canRoll,
  isMyTurn,
  onReleaseAll,
  onRoll,
  rolling,
  submitted,
  submitting,
  wide,
}: {
  activePlayerName: string | undefined
  canReleaseAll: boolean
  canRoll: boolean
  isMyTurn: boolean
  onReleaseAll: () => void
  onRoll: () => void
  rolling: boolean
  submitted: boolean
  submitting: boolean
  wide: boolean
}) {
  if (submitted) return <WaitingNotice activePlayerName={undefined} submitted />
  if (!isMyTurn) return <WaitingNotice activePlayerName={activePlayerName} submitted={false} />

  return (
    <>
      <Button
        className={cn('min-h-15 rounded-panel text-base', wide ? 'w-[300px]' : 'flex-1')}
        data-tutorial="roll"
        disabled={!canRoll}
        loading={rolling || submitting}
        onClick={onRoll}
        size="lg"
      >
        {rolling ? '굴리는 중' : '굴리기'}
        {wide && !rolling && <span className="ml-2 text-xs font-medium opacity-70">Space</span>}
      </Button>
      {wide && (
        <Button
          className="min-h-15"
          disabled={!canReleaseAll}
          onClick={onReleaseAll}
          variant="ghost"
        >
          모두 해제
        </Button>
      )}
    </>
  )
}
