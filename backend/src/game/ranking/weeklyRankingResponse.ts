import type { WeeklyRanking } from './weeklyRankingService.js'

/**
 * 주간 랭킹 응답 조립.
 *
 * 모양의 정본은 프론트다: `frontend/src/shared/api/rankingApi.ts`의
 * `WeeklyRanking`(camelCase — 방 REST의 snake_case가 아니다).
 *
 * 라우트 파일이 아니라 도메인 모듈에 둔 것은 이 규칙이 순수 함수이고 MySQL 없이
 * 테스트되어야 하기 때문이다. Java도 컨트롤러가 아닌 DTO에 두고 별도 단위
 * 테스트(`WeeklyRankingResponseTest`)로 고정한다.
 */

export interface WeeklyRankingEntry {
  /** 1부터. 동점자는 같은 번호를 받는다. */
  readonly rank: number
  readonly userId: string
  readonly nickname: string
  /** 이 주에 낸 **한 판** 최고점(누적이 아니다). */
  readonly bestScore: number
}

export interface WeeklyRankingResponse {
  readonly weekStart: string
  readonly entries: readonly WeeklyRankingEntry[]
}

/**
 * 순위 번호는 **서버가 매긴다** — 동점 처리를 클라이언트마다 다르게 하면 같은
 * 데이터가 화면마다 다른 순위로 보인다.
 *
 * 동점은 같은 번호를 주고 다음 번호를 건너뛴다(1, 2, 2, 4). 그러면 순위 번호가 곧
 * "나보다 잘한 사람이 몇 명인가 + 1"을 뜻하게 되어, `myCurrentWeek`가 세는
 * `countMembersScoringMoreThan + 1`과 **정확히 같은 값**이 된다. 두 경로가
 * 갈리면 같은 사람이 화면 두 곳에서 다른 순위로 보인다.
 */
export const weeklyRankingResponse = (ranking: WeeklyRanking): WeeklyRankingResponse => {
  const entries: WeeklyRankingEntry[] = []
  let rank = 0
  let previousScore: number | undefined
  for (const [index, row] of ranking.rows.entries()) {
    if (row.bestScore !== previousScore) {
      rank = index + 1
      previousScore = row.bestScore
    }
    entries.push({
      rank,
      userId: row.userId,
      nickname: row.nickname,
      bestScore: row.bestScore,
    })
  }
  return { weekStart: ranking.weekStart, entries }
}
