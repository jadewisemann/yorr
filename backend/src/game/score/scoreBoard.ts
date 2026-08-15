import { SCORE_CATEGORIES, type ScoreCategory } from './scoreCategory.js'
import { ScoreDomainError } from './scoreErrors.js'

/**
 * 카테고리별 확정 점수. **항상 12키 전부**가 있고, 값이 `null`이면 미기록이다.
 *
 * `null`(미기록)과 `0`(기록하고 희생)의 구분이 이 도메인의 계약이다 —
 * 타임아웃 시 서버가 고를 빈 칸, 게임 종료 판정(12칸 다 찼는가), 조회 REST의
 * 12키 직렬화가 전부 이 구분 위에 서 있다. `undefined`를 쓰지 않는 이유도
 * 같다: JSON으로 나갈 때 키가 사라지면 12키 계약이 깨진다.
 */
type ScoreBoardCategories = Readonly<Record<ScoreCategory, number | null>>

/** 점수판 — 생성 시점에 정규화·검증하고 얼린다. */
export interface ScoreBoard {
  readonly categories: ScoreBoardCategories
  readonly upperSubtotal: number
  readonly upperBonus: number
  readonly total: number
}

/**
 * 부분 맵을 받아 12키를 채운 점수판을 만든다 — 생성이 곧 검증 지점이다.
 * 입력은 방어적으로 복사하고 결과는 동결한다 — 호출부가 넘긴 맵을 나중에 바꿔도
 * 점수판은 변하지 않고, 점수판을 통해 상태를 되고칠 수도 없다.
 */
export const createScoreBoard = (
  categories: Readonly<Record<string, number | null | undefined>>,
  upperSubtotal: number,
  upperBonus: number,
  total: number,
): ScoreBoard => {
  if (categories === null || categories === undefined) {
    throw new ScoreDomainError('카테고리별 점수는 null일 수 없습니다.')
  }
  if (upperSubtotal < 0 || upperBonus < 0 || total < 0) {
    throw new ScoreDomainError('점수 합계는 0 이상이어야 합니다.')
  }

  const normalized: Partial<Record<ScoreCategory, number | null>> = {}
  for (const category of SCORE_CATEGORIES) {
    const score = categories[category]
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
