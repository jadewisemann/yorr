import type { YachtCategory } from '@/domain/scoring'

/**
 * 족보 한 줄의 4상태. 색 하나로만 구분하지 않는다 —
 * 테두리 굵기·패턴·라벨을 함께 바꿔 흑백에서도 읽히게 한다(와이어프레임 ⑤).
 *
 * 이 상태를 계산하는 곳(categoryRowState)이 여기이므로 타입도 여기서 소유한다.
 * ScoreRow가 이 타입을 가지면 components → yachtCategoryView → components 순환이 된다.
 */
export type ScoreRowState = 'available' | 'selected' | 'used' | 'zeroed'

/** 와이어프레임이 지정한 족보 표기. 짧은 영문 표기가 320px 2열에서 줄바꿈 없이 들어간다. */
export const categoryLabel: Record<YachtCategory, string> = {
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  choice: 'Choice',
  fourOfAKind: '4 of a Kind',
  fullHouse: 'Full House',
  smallStraight: 'S. Straight',
  largeStraight: 'L. Straight',
  yacht: 'Yacht',
}

/** 추천 족보 3열 그리드처럼 폭이 더 좁은 자리에서 쓰는 표기. */
export const categoryShortLabel: Record<YachtCategory, string> = {
  ...categoryLabel,
  fourOfAKind: '4 Kind',
  fullHouse: 'F.House',
  smallStraight: 'S.Straight',
  largeStraight: 'L.Straight',
}

/**
 * 기록된 점수와 선택 여부로 행 상태를 정한다.
 * 0점으로 확정한 족보는 "사용됨"과 구분해서 보여줘야 손실이 눈에 남는다.
 */
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
