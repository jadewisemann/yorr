import { SCORE_CATEGORIES, type ScoreCategory } from './scoreCategory.js'
import { ScoreDomainError } from './scoreErrors.js'

// Stryker disable StringLiteral: 여기서 던지는 메시지는 사람이 읽는 설명이지 계약이
// 아니다(scoreErrors.ts 주석 — 상위 계층이 이유 코드로 옮겨 담는다). 문구를 검사에
// 박으면 문구를 다듬을 때마다 검사가 깨진다.

/**
 * 카테고리별 확정 점수. **항상 12키 전부**가 있고, 값이 `null`이면 미기록이다.
 *
 * `null`(미기록)과 `0`(기록하고 희생)의 구분이 이 도메인의 계약이다 —
 * 타임아웃 시 서버가 고를 빈 칸, 게임 종료 판정(12칸 다 찼는가), 조회 REST의
 * 12키 직렬화가 전부 이 구분 위에 서 있다. `undefined`를 쓰지 않는 이유도
 * 같다: JSON으로 나갈 때 키가 사라지면 12키 계약이 깨진다.
 */
type ScoreBoardCategories = Readonly<Record<ScoreCategory, number | null>>

/** 점수판. 생성 시점에 정규화·검증하고 얼린다. */
export interface ScoreBoard {
  readonly categories: ScoreBoardCategories
  readonly upperSubtotal: number
  readonly upperBonus: number
  readonly total: number
}

/**
 * 부분 맵을 받아 12키를 채운 점수판을 만든다 — **생성 자체가 검증 지점**이다.
 * 입력은 방어적으로 복사하고 결과는 동결한다 — 호출부가 넘긴 맵을 나중에 바꿔도
 * 점수판은 변하지 않고, 점수판을 통해 상태를 되고칠 수도 없다.
 */
export const createScoreBoard = (
  categories: Readonly<Record<string, number | null | undefined>>,
  upperSubtotal: number,
  upperBonus: number,
  total: number,
): ScoreBoard => {
  // 타입이 이미 막는 입력에 대한 런타임 방어다. 이 분기를 죽이려면 검사가 타입을
  // 속여야 하는데, 그것은 타입 이완을 0으로 유지한다는 다른 기준과 부딪힌다.
  // Stryker disable all
  if (categories === null || categories === undefined) {
    throw new ScoreDomainError('카테고리별 점수는 null일 수 없습니다.')
  }
  // Stryker restore all
  if (upperSubtotal < 0 || upperBonus < 0 || total < 0) {
    throw new ScoreDomainError('점수 합계는 0 이상이어야 합니다.')
  }

  const normalized: Partial<Record<ScoreCategory, number | null>> = {}
  for (const category of SCORE_CATEGORIES) {
    const score = categories[category]
    // `null` 검사를 지워도 결과가 같다 — 통과한 `null`은 `< 0`이 false라 그대로
    // `null`로 저장된다(등가). 두 값을 함께 적어 두는 것은 의도를 읽히게 하려는 것이다.
    // Stryker disable next-line all
    if (score === undefined || score === null) {
      normalized[category] = null
      continue
    }
    if (score < 0) {
      throw new ScoreDomainError('카테고리 점수는 0 이상이어야 합니다.')
    }
    normalized[category] = score
  }

  return Object.freeze({
    categories: Object.freeze(normalized as Record<ScoreCategory, number | null>),
    upperSubtotal,
    upperBonus,
    total,
  })
}

/** 아직 아무것도 기록하지 않은 점수판(= Redis에 해시가 없는 상태의 표현). */
export const emptyScoreBoard = (): ScoreBoard => createScoreBoard({}, 0, 0, 0)

/**
 * 아직 비어 있는 칸을 **선언 순서대로** 돌려준다. 마감 시각에 서버가 대신 기록할
 * 칸을 고르는 근거라 순서가 고정이어야 재현이 된다.
 */
export const openCategoriesOf = (scoreboard: ScoreBoard): ScoreCategory[] =>
  SCORE_CATEGORIES.filter((category) => scoreboard.categories[category] === null)
