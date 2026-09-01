import { YACHT_DICE } from '../catalog.js'
import { weekBoundaryOf } from './weekBoundary.js'
import type { WeeklyBest, WeeklyRankingRepository } from './weeklyRankingStore.js'

/**
 * 이번 주 최고점 랭킹.
 *
 * 랭킹이 바뀔 수 있는 시점은 판이 끝날 때뿐이므로(한 판이 10~30분) 주기적으로 다시
 * 세지 않는다. 집계는 요청 때 MySQL이 하고, 그 결과를 캐시가 들고 있다가 전적
 * 보관이 비운다(`weeklyRankingCache.ts`).
 */

/** 랭킹 보드가 한 화면에 보여줄 수 있는 상한. 그 이상은 요청해도 잘라낸다. */
export const MAX_LIMIT = 100

export interface WeeklyRanking {
  /** 이 순위가 속한 주의 시작 날짜(KST 월요일, `YYYY-MM-DD`). */
  readonly weekStart: string
  /**
   * 점수 내림차순. **순위 번호는 붙이지 않는다** — 동점 처리는 표현의 문제라
   * 응답을 만드는 쪽이 정한다(`weeklyRankingResponse.ts`).
   */
  readonly rows: readonly WeeklyBest[]
}

export interface MyWeeklyRank {
  readonly weekStart: string
  /**
   * 상위 목록과 **같은 번호 체계**다 — 동점은 같은 번호를 받고 다음을 건너뛴다.
   * 그래서 목록에 내가 있으면 거기 적힌 번호와 이 값이 일치한다.
   */
  readonly rank: number
  readonly bestScore: number
}

/** [1, MAX_LIMIT]로 자른다. 정수가 아닌 값은 라우트가 이미 걸러 낸다. */
const clampLimit = (limit: number): number => Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT))

export class WeeklyRankingService {
  private readonly gameCode: string

  constructor(
    private readonly participants: WeeklyRankingRepository,
    /** 시각 주입 — 테스트가 주 경계를 초 단위로 고정한다. */
    private readonly now: () => Date = () => new Date(),
    options: { readonly gameCode?: string } = {},
  ) {
    // 게임 코드는 질의 파라미터지만 서비스가 **야추로 고정**한다. duel·pingpong은
    // 보관은 되지만 랭킹에 잡히지 않는 것이 계약이다(persistence.md). 다른 게임의
    // 보드를 열려면 이 자리를 REST 파라미터로 올려야 하고 그건 계약 변경이다.
    this.gameCode = options.gameCode ?? YACHT_DICE
  }

  async currentWeek(limit: number): Promise<WeeklyRanking> {
    const week = weekBoundaryOf(this.now())
    const rows = await this.participants.findWeeklyBest(
      this.gameCode,
      week.from,
      week.to,
      clampLimit(limit),
    )
    return { weekStart: week.weekStart, rows }
  }

  /**
   * 한 회원의 이번 주 순위. 상위 목록에 없어도 자기 자리를 알 수 있어야 한다 —
   * 100위 밖이면 목록만으로는 "내가 어디 있는지"에 영원히 답할 수 없다.
   *
   * @returns 이번 주에 끝낸 판이 없으면 `undefined`. 0점과 구분한다(→ REST 204).
   */
  async myCurrentWeek(userId: string): Promise<MyWeeklyRank | undefined> {
    const week = weekBoundaryOf(this.now())
    const best = await this.participants.findWeeklyBestScoreOf(
      userId,
      this.gameCode,
      week.from,
      week.to,
    )
    if (best === undefined) return undefined

    const better = await this.participants.countMembersScoringMoreThan(
      best,
      this.gameCode,
      week.from,
      week.to,
    )
    return { weekStart: week.weekStart, rank: better + 1, bestScore: best }
  }
}
