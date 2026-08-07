import type { YachtCategory } from '@/yacht/domain/scoring'

export type ScoreRowState = 'available' | 'selected' | 'used' | 'zeroed'

export const categoryLabel: Record<YachtCategory, string> = {
  ones: '에이스',
  twos: '듀스',
  threes: '트레이',
  fours: '포',
  fives: '파이브',
  sixes: '식스',
  choice: '초이스',
  fourOfAKind: '포커',
  fullHouse: '풀하우스',
  smallStraight: '스몰 스트레이트',
  largeStraight: '라지 스트레이트',
  yacht: '요트',
}

export const categoryShortLabel: Record<YachtCategory, string> = {
  ...categoryLabel,
  smallStraight: '스몰',
  largeStraight: '라지',
}

export const categoryDescription: Record<YachtCategory, string> = {
  ones: '주사위 중 1의 합',
  twos: '주사위 중 2의 합',
  threes: '주사위 중 3의 합',
  fours: '주사위 중 4의 합',
  fives: '주사위 중 5의 합',
  sixes: '주사위 중 6의 합',
  choice: '주사위 5개의 합',
  fourOfAKind: '같은 눈 4개 이상 → 주사위 전체 합',
  fullHouse: '같은 눈 3개 + 같은 눈 2개 → 주사위 전체 합',
  smallStraight: '연속된 눈 4개 → 15점',
  largeStraight: '연속된 눈 5개 → 30점',
  yacht: '같은 눈 5개 → 50점',
}

export function categoryRowState(
  recorded: number | null | undefined,
  selected: boolean,
): ScoreRowState {
  if (recorded !== null && recorded !== undefined) return recorded === 0 ? 'zeroed' : 'used'
  return selected ? 'selected' : 'available'
}

export function isRecorded(recorded: number | null | undefined): recorded is number {
  return recorded !== null && recorded !== undefined
}
