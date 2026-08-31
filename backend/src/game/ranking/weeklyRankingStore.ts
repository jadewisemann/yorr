import type { Pool, RowDataPacket } from 'mysql2/promise'

/**
 * 주간 집계 질의 3종.
 *
 * 읽는 테이블은 `matches`·`match_participants`(전적 보관 4.4가 쓰는 것)와 `users`다.
 * **집계의 권위는 MySQL 하나**다 — 별도 순위 자료구조(Redis ZSET 등)를 두지 않는다.
 * 두 곳이 각자 세면 어긋난 뒤 스스로 복구하지 못한다(persistence.md 「주간 랭킹」).
 *
 * Java에서는 이 인터페이스가 전적 패키지(`game/match`)에 있었다. 여기서는 랭킹
 * 모듈에 두는데, 읽는 쪽이 소유해야 4.4(쓰기)와 4.5(읽기)가 서로의 파일을 건드리지
 * 않고 같은 테이블을 나눠 쓸 수 있다. 스키마 계약은 Flyway V2 하나뿐이므로
 * 인터페이스가 어디 있든 결합은 같다.
 */

/** 한 회원의 주간 최고점 한 줄. 닉네임은 **현재 프로필 이름**이다. */
export interface WeeklyBest {
  readonly userId: string
  readonly nickname: string
  readonly bestScore: number
}

export interface WeeklyRankingRepository {
  /**
   * 기간 안에 끝난 판들에서 회원별 **한 판 최고점**을 점수 내림차순으로 뽑는다.
   *
   * @param from 포함 · `to` 제외 — 반개구간이라 한 판이 두 주에 세어지지 않는다
   * @param limit 이미 클램프된 값이 온다(서비스가 [1,100]으로 자른다)
   */
  findWeeklyBest(
    gameCode: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<readonly WeeklyBest[]>

  /**
   * 한 회원의 주간 최고점. 이번 주에 끝낸 판이 없으면 `undefined`다 — **0점과
   * 구분해야 한다.** 0점은 순위에 오르지만 기록 없음은 오를 자리 자체가 없다
   * (→ REST 204).
   */
  findWeeklyBestScoreOf(
    userId: string,
    gameCode: string,
    from: Date,
    to: Date,
  ): Promise<number | undefined>

  /**
   * 주간 최고점이 `score`보다 **높은** 회원 수. 내 순위는 이 값 + 1이다.
   *
   * 최고점을 다시 집계하지 않고 판 행을 바로 세도 되는 이유: 어떤 판에서든
   * `score`를 넘긴 회원은 그 주 최고점도 `score`를 넘고 반대도 성립한다.
   * 초과(`>`)만 세는 것이 목록의 동점 번호 매김(1,2,2,4)과 같은 값을 만든다.
   */
  countMembersScoringMoreThan(
    score: number,
    gameCode: string,
    from: Date,
    to: Date,
  ): Promise<number>
}

interface WeeklyBestRow extends RowDataPacket {
  readonly userId: string
  readonly nickname: string
  readonly bestScore: number | string
}

interface BestScoreRow extends RowDataPacket {
  readonly bestScore: number | string | null
}

interface CountRow extends RowDataPacket {
  readonly members: number | string
}

/**
 * MySQL 구현. 스키마는 Flyway V1(`users`)·V2(`matches`·`match_participants`)이고
 * 전환기에는 바꾸지 않는다(persistence.md 「전환기 스키마 동결」).
 *
 * `auth/socialAccountStore.ts`·`user/profile.ts`와 같은 결이다: 풀을 주입받고,
 * 풀을 닫지 않고, 행 → 도메인 변환을 이 파일 안에서 끝낸다.
 *
 * 시각 파라미터는 `Date`로 넘긴다. 풀의 `timezone: 'Z'`가 UTC 벽시계로 적어 주므로
 * `finished_at DATETIME(6)`과 같은 기준으로 비교된다(4.1의 결정 — 이걸 놓치면
 * 개발 KST / 운영 UTC가 9시간 어긋난다).
 */
export class MysqlWeeklyRankingStore implements WeeklyRankingRepository {
  constructor(private readonly pool: Pool) {}

  async findWeeklyBest(
    gameCode: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<readonly WeeklyBest[]> {
    // `JOIN users`가 게스트 행(user_id NULL)을 빼는데도 `IS NOT NULL`을 명시하는
    // 이유는 "회원만 센다"가 이 질의의 **의도**이고, 조인 방식이 바뀌어도 그 의도가
    // 남아야 하기 때문이다.
    //
    // 정렬에 user_id를 덧붙인 건 동점자 순서를 고정하기 위함이다 — 없으면 같은
    // 요청이 호출마다 다른 순서를 낼 수 있다.
    const [rows] = await this.pool.query<WeeklyBestRow[]>(
      `SELECT p.user_id AS userId, u.nickname AS nickname, MAX(p.total_score) AS bestScore
         FROM match_participants p
         JOIN matches m ON m.id = p.match_id
         JOIN users u ON u.id = p.user_id
        WHERE p.user_id IS NOT NULL
          AND m.game_code = ?
          AND m.finished_at >= ?
          AND m.finished_at < ?
        GROUP BY p.user_id, u.nickname
        ORDER BY MAX(p.total_score) DESC, p.user_id ASC
        LIMIT ?`,
      [gameCode, from, to, limit],
    )
    return rows.map((row) => ({
      userId: row.userId,
      nickname: row.nickname,
      bestScore: Number(row.bestScore),
    }))
  }

  async findWeeklyBestScoreOf(
    userId: string,
    gameCode: string,
    from: Date,
    to: Date,
  ): Promise<number | undefined> {
    // 여기서는 users를 조인하지 않는다 — user_id 컬럼만으로 판정된다(Java의
    // `p.user.id = :userId`도 조인을 만들지 않는다). 탈퇴로 users 행이 사라진
    // 회원까지 잡히지만, 그런 세션은 인증 단계를 통과하지 못하므로 도달할 수 없다.
    const [rows] = await this.pool.query<BestScoreRow[]>(
      `SELECT MAX(p.total_score) AS bestScore
         FROM match_participants p
         JOIN matches m ON m.id = p.match_id
        WHERE p.user_id = ?
          AND m.game_code = ?
          AND m.finished_at >= ?
          AND m.finished_at < ?`,
      [userId, gameCode, from, to],
    )
    // 매칭되는 행이 없어도 집계 질의는 한 줄(NULL)을 돌려준다 — 그게 "기록 없음"이다.
    const best = rows[0]?.bestScore
    return best === null || best === undefined ? undefined : Number(best)
  }

  async countMembersScoringMoreThan(
    score: number,
    gameCode: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const [rows] = await this.pool.query<CountRow[]>(
      `SELECT COUNT(DISTINCT p.user_id) AS members
         FROM match_participants p
         JOIN matches m ON m.id = p.match_id
        WHERE p.user_id IS NOT NULL
          AND m.game_code = ?
          AND m.finished_at >= ?
          AND m.finished_at < ?
          AND p.total_score > ?`,
      [gameCode, from, to, score],
    )
    return Number(rows[0]?.members ?? 0)
  }
}
