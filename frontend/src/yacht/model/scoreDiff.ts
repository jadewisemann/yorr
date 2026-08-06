import type { ScoreBoard } from '@/realtime/wsEvents'
import { YACHT_CATEGORIES, type YachtCategory } from '@/yacht/domain/scoring'
import { isRecorded } from '@/yacht/domain/yachtCategoryView'

/** 두 점수판을 비교해 이번에 새로 채워진 족보 하나를 찾는다. 없으면 null. */
export function newlyRecordedCategory(
  previous: ScoreBoard | undefined,
  next: ScoreBoard,
): [YachtCategory, number] | null {
  for (const category of YACHT_CATEGORIES) {
    const after = next.categories[category]
    if (after !== null && after !== undefined && !isRecorded(previous?.categories[category])) {
      return [category, after]
    }
  }
  return null
}
