import { FACE_PIPS } from '@/yacht/domain/dice'
import type { YachtCategory } from '@/yacht/domain/scoring'

const GRID = [6, 10, 14] as const

const faceByCategory: Partial<Record<YachtCategory, 1 | 2 | 3 | 4 | 5 | 6>> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
}

const patternPips: Partial<Record<YachtCategory, Array<[number, number]>>> = {
  choice: [
    [5, 5],
    [15, 5],
    [10, 10],
    [5, 15],
    [15, 15],
  ],
  fourOfAKind: [
    [6.5, 6.5],
    [13.5, 6.5],
    [6.5, 13.5],
    [13.5, 13.5],
  ],
  fullHouse: [
    [6.5, 6],
    [13.5, 6],
    [4, 14],
    [10, 14],
    [16, 14],
  ],
  smallStraight: [
    [4.5, 4.5],
    [10, 10],
    [15.5, 15.5],
  ],
  largeStraight: [
    [3.5, 3.5],
    [7.8, 7.8],
    [12.2, 12.2],
    [16.5, 16.5],
  ],
  yacht: [
    [10, 3.5],
    [4, 8.5],
    [16, 8.5],
    [6.5, 16],
    [13.5, 16],
  ],
}

export function CategoryIcon({
  category,
  className,
}: {
  category: YachtCategory
  className?: string
}) {
  const face = faceByCategory[category]
  const pips: Array<[number, number]> = face
    ? FACE_PIPS[face].map((position) => [
        GRID[(position - 1) % 3] as number,
        GRID[Math.ceil(position / 3) - 1] as number,
      ])
    : (patternPips[category] ?? [])

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
      {face && (
        <rect
          height={16.5}
          rx={4}
          stroke="currentColor"
          strokeWidth={1.6}
          width={16.5}
          x={1.75}
          y={1.75}
        />
      )}
      {pips.map(([x, y]) => (
        <circle cx={x} cy={y} fill="currentColor" key={`${x}-${y}`} r={face ? 1.8 : 2.1} />
      ))}
    </svg>
  )
}
