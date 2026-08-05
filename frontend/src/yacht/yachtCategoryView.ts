import type { YachtCategory } from '@/yacht/domain/scoring'

/**
 * 족보 한 줄의 4상태. 색 하나로만 구분하지 않는다 —
 * 테두리 굵기·패턴·라벨을 함께 바꿔 흑백에서도 읽히게 한다(와이어프레임 ⑤).
 *
 * 이 상태를 계산하는 곳(categoryRowState)이 여기이므로 타입도 여기서 소유한다.
 * ScoreRow가 이 타입을 가지면 components → yachtCategoryView → components 순환이 된다.
 */
export type ScoreRowState = 'available' | 'selected' | 'used' | 'zeroed'

/** S15P11A406-105 디자인 레퍼런스가 지정한 한글 족보 표기. 포커 = 4 of a Kind. */
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

/** 퀵 칩처럼 폭이 좁은 자리에서 쓰는 표기 — 레퍼런스의 DEV 단축키 표기(라지·스몰)를 따른다. */
export const categoryShortLabel: Record<YachtCategory, string> = {
  ...categoryLabel,
  smallStraight: '스몰',
  largeStraight: '라지',
}

/**
 * 족보 조건·점수 한 줄 설명(도움말 모달·툴팁 공용).
 * 점수 계산의 SSOT는 domain/scoring.ts다 — 여기 문구는 그 규칙의 표기일 뿐이다.
 */
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
