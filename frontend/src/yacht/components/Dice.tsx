import { cn } from '@/shared/cn'

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
        // border-black/15는 흰색 알파 사다리 밖이지만 회수 대상이 아니다 — 다이는
        // 실물 주사위라 테마를 따라가지 않는다(라이트에서도 상아색 면에 검은 모서리).
        // physics 토큰으로 올리지도 않는다: 그 네임스페이스는 "3D 렌더러가 읽는 색"이
        // 불변식이고(styles/tokenFallbacks.ts) 이 값은 CSS에서만 쓴다.
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
