import { cn } from '@/cn'

interface RollCounterProps {
  className?: string
  maxRolls?: number
  rollsUsed: number
}

/** 도트만으로는 개수를 세야 한다. 레퍼런스(S15P11A406-105) 하단 바처럼 텍스트를 병기한다. */
export function RollCounter({ className, maxRolls = 3, rollsUsed }: RollCounterProps) {
  const remaining = Math.max(0, maxRolls - rollsUsed)
  const slots = Array.from({ length: maxRolls }, (_, index) => `roll-${index + 1}`)

  return (
    <div className={cn('flex flex-none items-center gap-2', className)}>
      {/* 남은 굴림은 골드 도트, 쓴 굴림은 흐린 도트. */}
      <div aria-hidden="true" className="flex gap-1.5">
        {slots.map((slot, index) => (
          <span
            className={cn('size-2.5 rounded-full', index < remaining ? 'bg-brand' : 'bg-border')}
            key={slot}
          />
        ))}
      </div>
      <p className="m-0 text-[11px] font-medium text-content-faint">
        {remaining > 0 ? `남은 굴리기 ${remaining}회` : '굴림 소진'}
      </p>
    </div>
  )
}
