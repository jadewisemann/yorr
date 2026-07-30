import { cn } from '@/cn'

type DiceProps = {
  value: 1 | 2 | 3 | 4 | 5 | 6
  held?: boolean
  rolling?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}
const dots: Record<DiceProps['value'], number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}
const sizes = { sm: 'size-14 p-2', md: 'size-18 p-3', lg: 'size-24 p-4' } as const

export function Dice({ className, held = false, rolling = false, size = 'md', value }: DiceProps) {
  return (
    <div
      className={cn(
        // 아이보리 화이트 바디 + 딥 블랙 눈(디자인 시스템 06). 킵은 레드 보더·글로우로 구분한다.
        'grid aspect-square grid-cols-3 grid-rows-3 rounded-[18%] border border-black/15 bg-physics-die text-physics-pip shadow-raised',
        sizes[size],
        held && 'border-2 border-brand-strong ring-4 ring-brand/30',
        rolling && 'animate-dice-roll motion-reduce:animate-none',
        className,
      )}
      role="img"
      aria-label={`주사위 ${value}${held ? ', 킵됨' : ''}`}
    >
      {dots[value].map((position) => (
        <span
          key={position}
          className="size-2.5 place-self-center rounded-full bg-current"
          style={{ gridArea: `${Math.ceil(position / 3)} / ${((position - 1) % 3) + 1}` }}
        />
      ))}
    </div>
  )
}
