import { cn } from '@/cn'

interface RollCounterProps {
  className?: string
  maxRolls?: number
  rollsUsed: number
}

/** 도트만으로는 개수를 세야 한다. 와이어프레임 1d대로 텍스트를 항상 병기한다. */
export function RollCounter({ className, maxRolls = 3, rollsUsed }: RollCounterProps) {
  const remaining = Math.max(0, maxRolls - rollsUsed)
  const slots = Array.from({ length: maxRolls }, (_, index) => `roll-${index + 1}`)

  return (
    <div className={cn('flex-none text-center', className)}>
      <div aria-hidden="true" className="flex justify-center gap-1">
        {slots.map((slot, index) => (
          <span
            className={cn(
              'size-2.5 rounded-full',
              index < rollsUsed ? 'bg-brand' : 'border border-content-faint',
            )}
            key={slot}
          />
        ))}
      </div>
      <p className="mt-1 text-[9.5px] font-medium text-content-faint">
        {remaining > 0 ? `굴림 ${remaining}회 남음` : '굴림 소진'}
      </p>
    </div>
  )
}
