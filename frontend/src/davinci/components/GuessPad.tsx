import { GUESSABLE_NUMBERS, numberLabel } from '@/davinci/domain/davinci'
import { cn } from '@/shared/cn'
import { Button } from '@/shared/components/Button'

interface GuessPadProps {
  disabled: boolean
  onPick: (value: number) => void
  onSubmit: () => void
  picked: number | null
  targetName: string | null
}

/**
 * 숫자 패드. 0~11과 조커를 한 화면에 늘어놓는다 — 다이얼이나 드럼으로 줄이면 남은
 * 후보를 한눈에 훑는 이 게임의 사고 과정이 화면에서 사라진다.
 */
export function GuessPad({ disabled, onPick, onSubmit, picked, targetName }: GuessPadProps) {
  return (
    <div className="grid gap-2.5">
      <p className="m-0 text-center text-game-content-muted text-sm">
        {targetName === null
          ? '상대의 감춘 타일을 먼저 고르세요.'
          : `${targetName}의 타일 — 숫자를 부르세요.`}
      </p>
      <div className="grid grid-cols-6 gap-1.5">
        {GUESSABLE_NUMBERS.map((value) => (
          <button
            aria-pressed={picked === value}
            className={cn(
              'min-h-tap rounded-control border font-bold tabular-nums transition-colors pressable focus-ring',
              picked === value
                ? 'border-transparent bg-dv-accent text-on-brand'
                : 'border-dv-line bg-dv-surface text-game-content hover:bg-dv-surface-raised',
              value < 0 && 'col-span-2 text-sm',
            )}
            key={value}
            onClick={() => onPick(value)}
            type="button"
          >
            {numberLabel(value)}
          </button>
        ))}
      </div>
      <Button
        disabled={disabled || picked === null || targetName === null}
        onClick={onSubmit}
        size="lg"
      >
        부르기
      </Button>
    </div>
  )
}
