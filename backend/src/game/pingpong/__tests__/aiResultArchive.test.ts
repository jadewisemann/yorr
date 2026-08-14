import { randomUUID } from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { expect, it } from 'vitest'
import { describeMysql, useMysql } from '../../../infra/__tests__/mysqlHarness.js'
import { runMigrations } from '../../../infra/migrations/runner.js'
import { MatchArchiveService, MysqlMatchArchiveStore } from '../../match/index.js'
import { AI_PLAYER_ID, GUEST_NICKNAME, PingPongAiResultService } from '../aiResultService.js'

/**
 * AI 결과의 **실 MySQL 절반** — 여기서만 확인되는 것 두 가지다:
 *
 * 1. `resultId`(= `matches.game_id`)의 UNIQUE 제약이 **중복 보고를 실제로 막는가**.
 *    서버가 판을 진행하지 않는 경로라 이 제약이 멱등의 전부다.
 * 2. **게스트의 행에 `user_id`가 없는가**(→ 주간 랭킹 질의에 걸리지 않는다). 회원
 *    판정은 users 테이블 조회이므로 그 테이블이 있어야 판정이 성립한다.
 *
 * ⚠️ `MYSQL_TEST_URL`이 없으면 **건너뛴다**(ADR-0005의 게이트). 점수 재검증·UUID·
 * 게스트/회원 분기 로직은 `aiResultService.test.ts`가 MySQL 없이 덮는다.
 */

const RESULT_ID = '4b72f136-f3c2-49c9-bfdb-290891fd8638'

interface ParticipantRow extends RowDataPacket {
  readonly user_id: string | null
  readonly player_id: string
  readonly display_nickname: string
  readonly total_score: number
  readonly ranking: number
}

describeMysql('탁구 AI 결과 보관 (실 MySQL)', () => {
  const mysqlPool = useMysql()

  const setUp = async (): Promise<{
    pool: Pool
    service: PingPongAiResultService
    signUp: (nickname: string) => Promise<string>
  }> => {
    const pool = mysqlPool()
    await runMigrations(pool)
    return {
      pool,
      service: new PingPongAiResultService(
        new MatchArchiveService(new MysqlMatchArchiveStore(pool)),
      ),
      signUp: async (nickname: string) => {
        const id = randomUUID()
        const at = new Date('2026-08-01T00:00:00.000Z')
        await pool.query(
          'INSERT INTO users (id, nickname, profile_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [id, nickname, null, at, at],
        )
        return id
      },
    }
  }

  const participantsOf = async (pool: Pool, gameId: string): Promise<ParticipantRow[]> => {
    const [rows] = await pool.query<ParticipantRow[]>(
      `SELECT p.user_id, p.player_id, p.display_nickname, p.total_score, p.ranking
         FROM match_participants p JOIN matches m ON m.id = p.match_id
        WHERE m.game_id = ? ORDER BY p.ranking`,
      [gameId],
    )
    return rows
  }

  it('회원의 AI 전적은 계정에 붙고 AI는 이름만 남는다', async () => {
    const { pool, service, signUp } = await setUp()
    const member = await signUp('카카오회원')

    await service.archive(
      { userId: member, nickname: '회원' },
      {
        resultId: RESULT_ID,
        humanScore: 11,
        aiScore: 7,
      },
    )

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT game_code, room_code, player_count FROM matches WHERE game_id = ?',
      [RESULT_ID],
    )
    expect(rows[0]).toMatchObject({
      game_code: 'PING_PONG',
      room_code: 'LOCAL_AI',
      player_count: 2,
    })

    const participants = await participantsOf(pool, RESULT_ID)
    expect(participants[0]).toMatchObject({
      user_id: member,
      player_id: member,
      display_nickname: '회원',
      total_score: 11,
      ranking: 1,
    })
    // AI는 users에 없으므로 계정이 붙지 않는다 — 랭킹에 오르지 않는다.
    expect(participants[1]).toMatchObject({
      user_id: null,
      player_id: AI_PLAYER_ID,
      total_score: 7,
      ranking: 2,
    })
  })

  /** 게스트는 자기 행조차 계정이 없다 — 주간 랭킹의 `JOIN users`가 통째로 뺀다. */
  it('게스트의 AI 전적은 계정 없이 남는다', async () => {
    const { pool, service } = await setUp()

    await service.archiveGuest({ resultId: RESULT_ID, humanScore: 5, aiScore: 11 })

    const participants = await participantsOf(pool, RESULT_ID)
    expect(participants.map((row) => row.user_id)).toEqual([null, null])
    expect(participants[1]).toMatchObject({
      display_nickname: GUEST_NICKNAME,
      total_score: 5,
      ranking: 2,
    })
  })

  /** 새로고침·재전송으로 같은 판이 두 번 쌓이지 않는다. */
  it('같은 resultId를 두 번 보고하면 한 판만 남는다', async () => {
    const { pool, service } = await setUp()
    const body = { resultId: RESULT_ID, humanScore: 11, aiScore: 9 }

    expect(await service.archiveGuest(body)).toBe(true)
    expect(await service.archiveGuest(body)).toBe(false)

    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM matches')
    expect(Number(rows[0]?.n)).toBe(1)
    expect(await participantsOf(pool, RESULT_ID)).toHaveLength(2)
  })
})
