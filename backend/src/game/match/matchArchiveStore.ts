import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

/**
 * 전적의 **쓰기 표면** — 보관에 필요한 것만 남긴 좁은 포트.
 *
 * 저장소를 포트로 뒤집은 이유는 `user/profile.ts`와 같다: 보관의 판정 로직
 * (멱등·닉네임 우선순위·회원/게스트 분기)은 MySQL 없이도 시험할 수 있어야 하고,
 * 그 로직이 실제로 틀리는 자리다.
 */
export interface MatchArchiveStore {
  /**
   * `users`에 있는 playerId만 골라 **현재 프로필 닉네임과 함께** 돌려준다.
   *
   * 회원 판정을 Redis 세션이 아니라 이 테이블로 하는 것이 계약이다(Java 주석) —
   * 판이 끝나는 시점에 세션이 만료됐다는 이유로 회원의 전적을 게스트로 남기면 그
   * 기록은 영영 주인을 잃는다. 닉네임까지 함께 읽는 이유는 방에서 이름을 찾지
   * 못한 참가자(게임 중 나간 사람)의 대체 이름이 프로필 이름이기 때문이다.
   */
  findMemberNicknames(playerIds: readonly string[]): Promise<ReadonlyMap<string, string>>

  /**
   * matches 1행 + match_participants N행을 **한 트랜잭션**으로 쓴다.
   *
   * @returns 이 호출이 실제로 저장했는지. 이미 보관된 판(`game_id` 중복)이면 false —
   *   실패가 아니라 "먼저 저장한 쪽을 그대로 둔다"는 뜻이다.
   */
  insert(record: MatchRecord): Promise<boolean>
}

/** 저장 직전의 참가자 한 행 — 이름·회원 판정이 이미 끝난 값이다. */
export interface MatchParticipantRow {
  /** 방 안에서 쓰인 식별자. 회원·게스트 모두 있다. */
  readonly playerId: string
  /** 회원이면 `users.id`(= playerId), 게스트면 null. */
  readonly userId: string | null
  /** 그때 화면에 보였던 이름. 20자 이내로 확정된 값이다. */
  readonly displayNickname: string
  readonly totalScore: number
  readonly ranking: number
}

/** 끝난 판 한 개. `player_count`는 참가자 수에서 나온다(따로 세지 않는다). */
export interface MatchRecord {
  readonly gameId: string
  readonly gameCode: string
  readonly roomCode: string
  /** UTC 벽시계로 저장된다 — 풀의 `timezone: 'Z'`가 그것을 보장한다(4.1). */
  readonly finishedAt: Date
  readonly participants: readonly MatchParticipantRow[]
}

interface UserRow extends RowDataPacket {
  readonly id: string
  readonly nickname: string
}

/**
 * MySQL 구현. 스키마는 Flyway V2(`matches`·`match_participants`)이고 전환기에는
 * 바꾸지 않는다(persistence.md 「전환기 스키마 동결」, ADR-0005).
 */
export class MysqlMatchArchiveStore implements MatchArchiveStore {
  constructor(private readonly pool: Pool) {}

  async findMemberNicknames(playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(playerIds)]
    if (unique.length === 0) return new Map()
    const placeholders = unique.map(() => '?').join(', ')
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT id, nickname FROM users WHERE id IN (${placeholders})`,
      unique,
    )
    return new Map(rows.map((row) => [row.id, row.nickname]))
  }

  async insert(record: MatchRecord): Promise<boolean> {
    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      // 빠른 경로(Java `existsByGameId`). 동시 호출에서는 이것이 깨지므로 최종
      // 방어선은 `uk_matches_game` 유니크 제약이다 — 아래 catch가 그 자리다.
      const [existing] = await conn.query<RowDataPacket[]>(
        'SELECT id FROM matches WHERE game_id = ?',
        [record.gameId],
      )
      if (existing.length > 0) {
        await conn.rollback()
        return false
      }
      const [inserted] = await conn.query<ResultSetHeader>(
        `INSERT INTO matches (game_id, game_code, room_code, player_count, finished_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          record.gameId,
          record.gameCode,
          record.roomCode,
          record.participants.length,
          record.finishedAt,
        ],
      )
      await this.insertParticipants(conn, inserted.insertId, record.participants)
      await conn.commit()
      return true
    } catch (error) {
      await conn.rollback().catch(() => {
        // 롤백 실패는 원래 오류를 가리지 않는다.
      })
      // 종료가 동시에 두 번 처리됐다. 유니크가 막았으니 먼저 저장한 쪽을 그대로 둔다.
      if (isDuplicateEntry(error)) return false
      throw error
    } finally {
      conn.release()
    }
  }

  /** 참가자는 한 문장으로 넣는다 — 왕복 수가 인원에 비례하지 않게. */
  private async insertParticipants(
    conn: PoolConnection,
    matchId: number,
    participants: readonly MatchParticipantRow[],
  ): Promise<void> {
    if (participants.length === 0) return
    const values = participants.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
    const parameters = participants.flatMap((participant) => [
      matchId,
      participant.userId,
      participant.playerId,
      participant.displayNickname,
      participant.totalScore,
      participant.ranking,
    ])
    await conn.query(
      `INSERT INTO match_participants
         (match_id, user_id, player_id, display_nickname, total_score, ranking)
       VALUES ${values}`,
      parameters,
    )
  }
}

/**
 * `game_id` 유니크 위반만 "이미 보관됨"으로 읽는다.
 *
 * **Java와 의도적으로 다르다.** Java는 `DataIntegrityViolationException`을 통째로
 * 잡아 false로 뭉갠다 — 그 갈래에는 FK 위반(참가자의 회원이 그 사이 사라짐)·길이
 * 위반도 들어 있다. 뭉개면 저장되지 않은 판이 "이미 저장됨"으로 조용히 사라진다.
 * 여기서는 1062만 false이고 나머지는 던진다 — 종료 경로가 그것을 삼켜
 * `onArchiveFailure`로 흘리므로(2.7) 게임은 그대로 끝나고 사실은 드러난다.
 * 4.2의 errno 승격(`auth/errors.ts`)과 같은 결이지만, 정책이 다르므로 공유하지 않는다.
 */
const isDuplicateEntry = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'errno' in error &&
  (error as { errno: unknown }).errno === 1062 // ER_DUP_ENTRY
