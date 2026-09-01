import type { Pool, RowDataPacket } from 'mysql2/promise'
import { expect, it } from 'vitest'
import { discoverMigrations } from '../migrations/discover.js'
import { MigrationError } from '../migrations/error.js'
import { DEFAULT_HISTORY_TABLE } from '../migrations/history.js'
import { runMigrations, verifyMigrations } from '../migrations/runner.js'
import { describeMysql, useMysql } from './mysqlHarness.js'

/**
 * 마이그레이션 러너의 통합 테스트 — 진짜 MySQL이 필요하다(ADR-0005).
 * `MYSQL_TEST_URL`이 없으면 통째로 건너뛴다. 순수 로직(버전 파싱·적용 순서·이력
 * 호환 판정·체크섬)은 MySQL 없이 도는 단위 테스트가 덮는다.
 */
describeMysql('마이그레이션 러너 (실 MySQL)', () => {
  const mysqlPool = useMysql()

  const tables = async (pool: Pool): Promise<string[]> => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name',
    )
    return rows.map((row) => String(row.name)).sort()
  }

  const history = async (pool: Pool): Promise<RowDataPacket[]> => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM \`${DEFAULT_HISTORY_TABLE}\` ORDER BY installed_rank`,
    )
    return rows
  }

  /** V1·V2가 이미 적용돼 있는 운영 DB를 그대로 재현한다. */
  const seedAppliedHistory = async (pool: Pool): Promise<void> => {
    await runMigrations(pool)
  }

  it('빈 스키마에 V1·V2를 순서대로 적용한다', async () => {
    const pool = mysqlPool()
    const report = await runMigrations(pool)

    expect(report.applied).toEqual(['V1__create_user_tables.sql', 'V2__create_match_tables.sql'])
    expect(await tables(pool)).toEqual([
      DEFAULT_HISTORY_TABLE,
      'match_participants',
      'matches',
      'social_accounts',
      'users',
    ])
  })

  it('이력 행이 Flyway와 같은 모양으로 남는다', async () => {
    const pool = mysqlPool()
    await runMigrations(pool)
    const local = await discoverMigrations()
    const rows = await history(pool)

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.installed_rank)).toEqual([1, 2])
    expect(rows.map((row) => row.version)).toEqual(['1', '2'])
    expect(rows.map((row) => row.description)).toEqual([
      'create user tables',
      'create match tables',
    ])
    expect(rows.map((row) => row.type)).toEqual(['SQL', 'SQL'])
    expect(rows.map((row) => row.script)).toEqual(local.map((m) => m.script))
    expect(rows.map((row) => row.checksum)).toEqual(local.map((m) => m.checksum))
    expect(rows.map((row) => Boolean(row.success))).toEqual([true, true])
    for (const row of rows) expect(String(row.installed_by).length).toBeGreaterThan(0)
  })

  it('두 번 돌려도 아무것도 적용하지 않는다(멱등)', async () => {
    const pool = mysqlPool()
    await runMigrations(pool)
    const second = await runMigrations(pool)

    expect(second.applied).toEqual([])
    expect(second.plan.pending).toEqual([])
    expect(await history(pool)).toHaveLength(2)
  })

  it('이미 적용된 DB에서 verify가 통과한다', async () => {
    const pool = mysqlPool()
    await seedAppliedHistory(pool)

    const report = await verifyMigrations(pool, { validateChecksums: true })
    expect(report.applied).toEqual([])
    expect(report.plan.pending).toEqual([])
    expect(report.plan.applied.map((m) => m.version)).toEqual(['1', '2'])
    expect(report.plan.checksumMismatches).toEqual([])
  })

  it('마이그레이션 안 된 DB를 가리키면 verify가 던진다', async () => {
    await expect(verifyMigrations(mysqlPool())).rejects.toThrow(MigrationError)
  })

  it('verify는 스키마를 바꾸지 않는다 — 이력 테이블조차 만들지 않는다', async () => {
    const pool = mysqlPool()
    await verifyMigrations(pool).catch(() => undefined)
    expect(await tables(pool)).toEqual([])
  })

  it('이력이 없는 기존 스키마에는 baseline 0을 찍고 전부 적용한다', async () => {
    const pool = mysqlPool()
    await pool.query('CREATE TABLE legacy_stuff (id INT PRIMARY KEY)')

    const report = await runMigrations(pool)
    const rows = await history(pool)

    expect(rows[0]?.type).toBe('BASELINE')
    expect(rows[0]?.version).toBe('0')
    // baseline-version이 1이면 V1이 건너뛰어진다 — 0이어야 둘 다 적용된다.
    expect(report.applied).toHaveLength(2)
    expect(rows.map((row) => row.version)).toEqual(['0', '1', '2'])
  })

  it('체크섬이 어긋나면 validateChecksums일 때만 던진다', async () => {
    const pool = mysqlPool()
    await runMigrations(pool)
    await pool.query(`UPDATE \`${DEFAULT_HISTORY_TABLE}\` SET checksum = 1 WHERE version = '1'`)

    const lenient = await verifyMigrations(pool)
    expect(lenient.plan.checksumMismatches).toHaveLength(1)
    await expect(verifyMigrations(pool, { validateChecksums: true })).rejects.toThrow(
      MigrationError,
    )
  })

  it('실패로 남은 이력 행이 있으면 더 진행하지 않는다', async () => {
    const pool = mysqlPool()
    await runMigrations(pool)
    await pool.query(`UPDATE \`${DEFAULT_HISTORY_TABLE}\` SET success = 0 WHERE version = '2'`)

    await expect(verifyMigrations(pool)).rejects.toThrow(/실패한 마이그레이션/)
    await expect(runMigrations(pool)).rejects.toThrow(/실패한 마이그레이션/)
  })

  it('실패한 마이그레이션은 success = 0으로 이력에 남는다', async () => {
    const pool = mysqlPool()
    // V1의 users 테이블을 미리 만들어 두면 V1 적용이 깨진다.
    await pool.query('CREATE TABLE users (id INT PRIMARY KEY)')
    await expect(runMigrations(pool, { baselineVersion: '0' })).rejects.toThrow(MigrationError)

    const rows = await history(pool)
    const last = rows.at(-1)
    expect(last?.version).toBe('1')
    expect(Boolean(last?.success)).toBe(false)
  })

  it('pool.timezone = Z 계약: DATETIME(6)을 UTC 벽시계로 읽고 쓴다', async () => {
    const pool = mysqlPool()
    await runMigrations(pool)
    const at = new Date('2026-08-14T00:30:00.000Z')
    await pool.query(
      'INSERT INTO matches (game_id, game_code, room_code, player_count, finished_at) VALUES (?,?,?,?,?)',
      ['g1', 'YACHT_DICE', 'R1', 2, at],
    )

    const [raw] = await pool.query<RowDataPacket[]>(
      'SELECT DATE_FORMAT(finished_at, "%Y-%m-%d %H:%i:%s") AS wall FROM matches',
    )
    expect(raw[0]?.wall).toBe('2026-08-14 00:30:00')

    const [parsed] = await pool.query<RowDataPacket[]>('SELECT finished_at FROM matches')
    const readBack = parsed[0]?.finished_at as Date | undefined
    expect(readBack?.toISOString()).toBe('2026-08-14T00:30:00.000Z')
  })
})
