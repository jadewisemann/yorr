import type { Ranking } from '../gameResultCalculator.js'

/**
 * 동점이 낀 네 사람의 순위. 2위가 둘이면 다음은 3위가 아니라 4위라는 규칙을
 * 순위 계산기와 종료 방송이 같은 값으로 고정한다.
 */
export const TIED_RANKINGS: readonly Ranking[] = [
  { rank: 1, playerId: 'player-b', total: 205 },
  { rank: 2, playerId: 'player-a', total: 180 },
  { rank: 2, playerId: 'player-c', total: 180 },
  { rank: 4, playerId: 'player-d', total: 90 },
]
