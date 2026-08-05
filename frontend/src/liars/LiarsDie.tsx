import { cn } from '@/shared/cn'

const pips: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

/**
 * 주사위 한 알. 야추의 `Dice`와 생김새는 닮았지만 그쪽은 킵·굴림 연출을 들고 있는
 * 야추 전용 부품이라, 게임 폴더를 가로질러 끌어오지 않고 필요한 만큼만 여기 둔다.
 */
export function LiarsDie({
  className,
  dim = false,
  marked = false,
  size = 'md',
  value,
}: {
  className?: string
  /** 남의 공개 손패처럼 참고로만 보이는 알. */
  dim?: boolean
  /** 지금 세고 있는 눈. 판정 화면에서 무엇이 세어졌는지 보여준다. */
  marked?: boolean
  size?: 'sm' | 'md'
  value: number
}) {
  return (
    <span
      aria-label={`주사위 ${value}`}
      className={cn(
        'grid aspect-square grid-cols-3 grid-rows-3 rounded-[22%] border border-black/15 bg-physics-die text-physics-pip shadow-raised',
        size === 'sm' ? 'size-8 p-1' : 'size-12 p-1.5',
        marked && 'border-2 border-brand-strong ring-4 ring-brand/30',
        dim && 'opacity-55',
        className,
      )}
      role="img"
    >
      {(pips[value] ?? []).map((position) => (
        <span
          className={cn(
            'place-self-center rounded-full bg-current',
            size === 'sm' ? 'size-1.5' : 'size-2',
          )}
          key={position}
          style={{ gridArea: `${Math.ceil(position / 3)} / ${((position - 1) % 3) + 1}` }}
        />
      ))}
    </span>
  )
}
