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
      {/* Modernist 롤 핍 — 남은 굴림은 accent 막대, 쓴 굴림은 회색 막대. */}
      <div aria-hidden="true" className="flex justify-center gap-1.5">
        {slots.map((slot, index) => (
          <span
            className={cn('h-2 w-8', index < maxRolls - rollsUsed ? 'bg-brand' : 'bg-border')}
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
