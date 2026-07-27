import { cn } from '@/cn'
import type { DiceIndex, DiceSet, HeldDice } from '@/domain/dice'
import { Dice } from './Dice'

interface KeepTrayProps {
  className?: string
  dice: DiceSet | null
  held: HeldDice
  /** 마지막 굴림 뒤에는 킵을 바꿀 수 없다. */
  locked?: boolean
  onRelease?: (index: DiceIndex) => void
}

/**
 * 남긴 주사위를 별도 트레이로 끌어올려 보여준다.
 * 색 하나로만 구분하면 흑백·색약에서 킵이 안 읽히므로
 * 위치(트레이) + 실선 테두리 + "KEEP" 라벨 3중으로 인코딩한다(1a 개선 ③).
 */
export function KeepTray({ className, dice, held, locked = false, onRelease }: KeepTrayProps) {
  const heldIndexes = held
    .map((isHeld, index) => (isHeld ? (index as DiceIndex) : null))
    .filter((index): index is DiceIndex => index !== null)

  return (
    <section
      aria-label={`남긴 주사위 ${heldIndexes.length}개`}
      className={cn(
        'rounded-card border-2 border-dashed border-brand bg-surface-sunken px-3 py-2.5',
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold tracking-wide text-brand-strong">
          KEEP · 남긴 주사위 {heldIndexes.length}
        </span>
        <span className="text-[10px] text-content-faint">
          {locked ? '이번 라운드는 변경할 수 없어요' : '탭하면 내려옵니다'}
        </span>
      </div>

      {heldIndexes.length === 0 || !dice ? (
        <p className="py-1.5 text-center text-[11.5px] text-content-faint">
          아직 남긴 주사위가 없어요
        </p>
      ) : (
        <ul className="flex list-none justify-center gap-2 p-0">
          {heldIndexes.map((index) => (
            <li key={index}>
              <button
                aria-label={`주사위 ${dice[index]}, 남김 해제`}
                aria-pressed={true}
                className="cursor-pointer rounded-card border-0 bg-transparent p-0 disabled:cursor-not-allowed focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-offset-2"
                disabled={locked}
                onClick={() => onRelease?.(index)}
                type="button"
              >
                <Dice held size="sm" value={dice[index]} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
