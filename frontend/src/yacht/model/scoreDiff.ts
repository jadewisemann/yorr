import type { ScoreBoard } from '@/realtime/wsEvents'
import { YACHT_CATEGORIES, type YachtCategory } from '@/yacht/domain/scoring'
import { isRecorded } from '@/yacht/domain/yachtCategoryView'

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
