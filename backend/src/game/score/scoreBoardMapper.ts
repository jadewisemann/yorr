import { createScoreBoard, type ScoreBoard } from './scoreBoard.js'
import { SCORE_CATEGORIES } from './scoreCategory.js'
import { ScoreDomainError } from './scoreErrors.js'

/**
 * 점수판 해시의 **메타 필드는 `_` 접두**다 — 카테고리 필드와 섞이지 않게 하려는
 * 규약이고, 게임 종료 판정(2.7)이 "`_` 비접두 필드 12개"로 완료를 세기 때문에
 * 새 메타 필드를 접두 없이 추가하면 종료가 영원히 성립하지 않는다.
 */
export const UPPER_SUBTOTAL_FIELD = '_upperSubtotal'
const UPPER_BONUS_FIELD = '_upperBonus'
export const TOTAL_FIELD = '_total'

const integerValue = (value: string | undefined, defaultValue: number | null): number | null => {
  if (value === undefined) return defaultValue
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new ScoreDomainError(`Redis score value must be an integer: ${value}`)
  }
  return parsed
}

/**
 * Redis 해시 → `ScoreBoard`.
 *
 * **없는 카테고리 필드는 null**(미기록), 없는 메타 필드는 0이다. 이 비대칭이
 * "null vs 0" 계약의 저장소 쪽 절반이다. 2.9의 조회 스토어도 같은 해시를 읽으므로
 * 이 매퍼를 공유한다.
 */
export const scoreBoardFromHash = (stored: Readonly<Record<string, string>>): ScoreBoard => {
  const categories: Record<string, number | null> = {}
  for (const category of SCORE_CATEGORIES) {
    categories[category] = integerValue(stored[category], null)
  }
  return createScoreBoard(
    categories,
    integerValue(stored[UPPER_SUBTOTAL_FIELD], 0) ?? 0,
    integerValue(stored[UPPER_BONUS_FIELD], 0) ?? 0,
    integerValue(stored[TOTAL_FIELD], 0) ?? 0,
  )
}
