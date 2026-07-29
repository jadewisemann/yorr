import type { YachtCategory } from '@/domain/scoring'

/**
 * 점수시트 족보 행 앞에 붙는 소형 아이콘 (디자인 레퍼런스 S15P11A406-105 점수시트).
 * 상단 족보(에이스~식스)는 해당 눈의 주사위 면, 하단 족보는 테두리 없는 pip 패턴으로
 * 구분한다 — 같은 점 배치라도 테두리 유무가 "주사위 눈"과 "족보 모양"을 가른다.
 * 항상 장식이므로 aria-hidden 고정, 색은 currentColor를 따른다.
 */

const GRID = [6, 10, 14] as const

/** Dice.tsx와 같은 3×3 그리드 눈 배치 (1~9 위치 번호). */
const facePips: Record<1 | 2 | 3 | 4 | 5 | 6, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

const faceByCategory: Partial<Record<YachtCategory, 1 | 2 | 3 | 4 | 5 | 6>> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
}

/** 하단 족보 pip 패턴 좌표 (20×20 viewBox). 초이스=X, 요트=오각형으로 서로 구분한다. */
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
    ? facePips[face].map((position) => [
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
