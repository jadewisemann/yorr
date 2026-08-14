import { randomUUID } from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { expect, it } from 'vitest'
import { describeMysql, useMysql } from '../../../infra/__tests__/mysqlHarness.js'
import { runMigrations } from '../../../infra/migrations/runner.js'
import type { CompletionRoomSnapshot, Ranking } from '../../completion/index.js'
import { MatchArchiveService } from '../matchArchiveService.js'
import { MysqlMatchArchiveStore } from '../matchArchiveStore.js'

/**
 * backend-java `MatchArchiveServiceIntegrationTest`의 MySQL 절반.
 *
 * Java 주석이 그 이유를 말한다: "결과 적재는 스키마·제약과 함께 움직인다
 * (`game_id` UNIQUE, `user_id` nullable + FK). 그 합은 실제 MySQL에서만 확인된다."
 * 여기서만 확인되는 것: 제약이 실제로 멱등을 지키는가, `finished_at`이 **UTC
 * 벽시계**로 적히는가(4.5의 KST 주 경계 질의가 그 값에 기댄다).
 *
 * ⚠️ `MYSQL_TEST_URL`이 없으면 **건너뛴다**(ADR-0005의 게이트). 로직 자체는
 * `matchArchiveService.test.ts`가 MySQL 없이 덮는다.
 */

const GAME_ID = 'game-1'
const FIXED_NOW = new Date('2026-08-14T02:03:04.005Z')

const room = (
  players: readonly { playerId: string; nickname: string }[],
): CompletionRoomSnapshot => ({
  roomCode: 'ROOM01',
  gameCode: 'YACHT_DICE',
  gameId: GAME_ID,
  players: players.map((player) => ({ ...player, kind: 'HUMAN' })),
})

const ranking = (rank: number, playerId: string, total: number): Ranking => ({
  rank,
  playerId,
  total,
})

describeMysql('MysqlMatchArchiveStore (실 MySQL)', () => {
  const mysqlPool = useMysql()

  /** 빈 스키마에 V1·V2를 적용하고 서비스를 조립한다. */
  const setUp = async (): Promise<{
    pool: Pool
    store: MysqlMatchArchiveStore
    service: MatchArchiveService
    signUp: (nickname: string) => Promise<string>
  }> => {
    const pool = mysqlPool()
    await runMigrations(pool)
    const store = new MysqlMatchArchiveStore(pool)
    return {
      pool,
      store,
      service: new MatchArchiveService(store, { now: () => FIXED_NOW }),
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

  interface ParticipantRow extends RowDataPacket {
    readonly user_id: string | null
    readonly player_id: string
    readonly display_nickname: string
    readonly total_score: number
    readonly ranking: number
  }

  const participantsOf = async (pool: Pool, gameId: string): Promise<ParticipantRow[]> => {
    const [rows] = await pool.query<ParticipantRow[]>(
      `SELECT p.user_id, p.player_id, p.display_nickname, p.total_score, p.ranking
         FROM match_participants p JOIN matches m ON m.id = p.match_id
        WHERE m.game_id = ? ORDER BY p.ranking, p.player_id`,
      [gameId],
    )
    return rows
  }

  const countMatches = async (pool: Pool): Promise<number> => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM matches')
    return Number(rows[0]?.n)
  }

  it('회원은_계정에_게스트는_이름만_남는다', async () => {
    const { pool, service, signUp } = await setUp()
    const member = await signUp('카카오회원')

    const saved = await service.archive(
      room([
        { playerId: member, nickname: '방에서쓴이름' },
        { playerId: 'guest-1', nickname: '지나가던손님' },
      ]),
      [ranking(1, member, 210), ranking(2, 'guest-1', 180)],
    )

    expect(saved).toBe(true)
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT game_id, game_code, room_code, player_count FROM matches WHERE game_id = ?',
      [GAME_ID],
    )
    expect(rows[0]).toMatchObject({
      game_id: GAME_ID,
      game_code: 'YACHT_DICE',
      room_code: 'ROOM01',
      player_count: 2,
    })
    const participants = await participantsOf(pool, GAME_ID)
    expect(participants).toHaveLength(2)
    expect(participants[0]).toMatchObject({
      user_id: member,
      total_score: 210,
      ranking: 1,
      // 그때 화면에 보였던 이름이어야 한다 — 프로필 닉네임이 아니라 방에서 쓴 이름이다.
      display_nickname: '방에서쓴이름',
    })
    expect(participants[1]?.user_id).toBeNull()
    expect(participants[1]?.display_nickname).toBe('지나가던손님')
  })

  it('같은_게임은_한_번만_저장된다', async () => {
    const { pool, service } = await setUp()
    const snapshot = room([{ playerId: 'guest-1', nickname: '손님' }])
    const rankings = [ranking(1, 'guest-1', 100)]

    expect(await service.archive(snapshot, rankings)).toBe(true)
    expect(await service.archive(snapshot, rankings)).toBe(false)

    expect(await countMatches(pool)).toBe(1)
    expect(await participantsOf(pool, GAME_ID)).toHaveLength(1)
  })

  it('순위가_비었으면_저장하지_않는다', async () => {
    const { pool, service } = await setUp()

    expect(await service.archive(room([]), [])).toBe(false)

    expect(await countMatches(pool)).toBe(0)
  })

  it('방에_없는_참가자도_이름을_찾아_남긴다', async () => {
    const { pool, service, signUp } = await setUp()
    const member = await signUp('떠난회원')

    await service.archive(room([]), [ranking(1, member, 150), ranking(2, 'guest-gone', 90)])

    const participants = await participantsOf(pool, GAME_ID)
    expect(participants[0]?.display_nickname).toBe('떠난회원')
    expect(participants[1]?.display_nickname).toBe('guest-gone')
  })

  // --- 이식하며 추가한 것 ---

  /**
   * `finished_at`은 **UTC 벽시계**다. 이 단정이 4.5(주간 랭킹)의 전제다 — KST 월요일
   * 00:00 경계를 UTC 일요일 15:00으로 바꿔 질의하는 것이 여기서 성립한다.
   */
  it('finished_at은 UTC 벽시계로 적힌다', async () => {
    const { pool, service } = await setUp()

    await service.archive(room([{ playerId: 'guest-1', nickname: '손님' }]), [
      ranking(1, 'guest-1', 10),
    ])

    interface FinishedAtRow extends RowDataPacket {
      readonly wall: string
      readonly finished_at: Date
    }
    const [rows] = await pool.query<FinishedAtRow[]>(
      "SELECT DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s.%f') AS wall, finished_at FROM matches",
    )
    const row = rows[0]
    if (row === undefined) throw new Error('보관된 판이 없다')
    expect(row.wall).toBe('2026-08-14 02:03:04.005000')
    // 같은 드라이버 설정(`timezone: 'Z'`)으로 읽으면 넣은 순간이 그대로 돌아온다.
    expect(row.finished_at.toISOString()).toBe(FIXED_NOW.toISOString())
  })

  /** 사전 확인은 동시 호출에서 깨진다 — 최종 방어선이 `uk_matches_game`인지 본다. */
  it('동시에 두 번 보관해도 한 판만 남는다', async () => {
    const { pool, service } = await setUp()
    const snapshot = room([{ playerId: 'guest-1', nickname: '손님' }])
    const rankings = [ranking(1, 'guest-1', 100)]

    const results = await Promise.all([
      service.archive(snapshot, rankings),
      service.archive(snapshot, rankings),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await countMatches(pool)).toBe(1)
    expect(await participantsOf(pool, GAME_ID)).toHaveLength(1)
  })

  /**
   * **Java와 의도적으로 다른 지점.** Java는 제약 위반 전체를 "이미 저장됨"(false)으로
   * 뭉갠다. FK 위반은 저장되지 않았다는 뜻이므로 여기서는 던진다 — 종료 경로가
   * 삼켜 `onArchiveFailure`로 흘리므로 게임은 끝나고 사실은 드러난다.
   */
  it('유니크가 아닌 제약 위반은 false로 뭉개지 않고 던진다', async () => {
    const { pool, store } = await setUp()

    await expect(
      store.insert({
        gameId: 'game-fk',
        gameCode: 'YACHT_DICE',
        roomCode: 'ROOM01',
        finishedAt: FIXED_NOW,
        participants: [
          {
            playerId: 'ghost',
            // users에 없는 계정 — FK가 막는다.
            userId: randomUUID(),
            displayNickname: '유령',
            totalScore: 1,
            ranking: 1,
          },
        ],
      }),
    ).rejects.toThrow()
    // 트랜잭션이므로 matches 행도 남지 않는다.
    expect(await countMatches(pool)).toBe(0)
  })

  it('findMemberNicknames는 users에 있는 사람만 회원으로 판정한다', async () => {
    const { store, signUp } = await setUp()
    const member = await signUp('회원')

    const found = await store.findMemberNicknames([member, 'guest-1', member])

    expect([...found]).toEqual([[member, '회원']])
    expect(await store.findMemberNicknames([])).toEqual(new Map())
  })

  it('archiveParticipants는 방 없이도 저장한다(탁구 AI 자리)', async () => {
    const { pool, service, signUp } = await setUp()
    const member = await signUp('탁구회원')

    const saved = await service.archiveParticipants({
      gameId: '1d61e930-cbea-41f3-935d-85fb95919e44',
      gameCode: 'PING_PONG',
      roomCode: 'LOCAL_AI',
      participants: [
        { playerId: member, totalScore: 11, ranking: 1 },
        { playerId: 'ping-pong-ai', displayNickname: 'AI', totalScore: 7, ranking: 2 },
      ],
    })

    expect(saved).toBe(true)
    const participants = await participantsOf(pool, '1d61e930-cbea-41f3-935d-85fb95919e44')
    expect(participants.map((row) => [row.player_id, row.total_score, row.user_id])).toEqual([
      [member, 11, member],
      ['ping-pong-ai', 7, null],
    ])
  })
})
