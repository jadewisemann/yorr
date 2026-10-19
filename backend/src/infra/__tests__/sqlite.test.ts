import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { ResultSetHeader, RowDataPacket } from '../sqlite.js'
import { createSqlitePool } from '../sqlite.js'

/**
 * 저장소 스위트(`useDb`)가 덮지 않는, 어댑터 자신의 계약만 본다.
 * 같은 판을 두 번 보관하는 경합·제약 위반 승격은 저장소 스위트가 이미 확인한다.
 */
const pool = createSqlitePool(':memory:')

afterEach(async () => {
  await pool.query('DELETE FROM users')
})

const insertUser = (conn: { query: typeof pool.query }, id: string) =>
  conn.query(
    'INSERT INTO users (id, nickname, profile_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, 'n', null, new Date(0), new Date(0)],
  )

it('쓰기는 mysql2처럼 [ResultSetHeader]를 돌려준다', async () => {
  const [header] = await insertUser(pool, 'u1')
  expect((header as unknown as ResultSetHeader).affectedRows).toBe(1)
})

it('Date는 ISO 8601 UTC 문자열로 적힌다', async () => {
  await insertUser(pool, 'u1')
  const [rows] = await pool.query<RowDataPacket[]>('SELECT created_at FROM users')
  expect(rows[0]?.created_at).toBe('1970-01-01T00:00:00.000Z')
})

it('트랜잭션이 끝나기 전에는 다른 질의가 끼어들지 못한다', async () => {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  await insertUser(conn, 'u1')
  // 다른 요청의 질의 — 잠금 때문에 롤백 뒤에야 돌아야 한다.
  const outside = pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users')
  await conn.rollback()
  conn.release()
  const [rows] = await outside
  expect(rows[0]?.n).toBe(0)
})

it('끝내지 않고 돌려준 트랜잭션은 release가 되돌린다', async () => {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  await insertUser(conn, 'u1')
  conn.release()

  const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users')
  expect(rows[0]?.n).toBe(0)
})

it('유니크 위반은 mysql2와 같은 errno 1062로 던진다', async () => {
  await insertUser(pool, 'u1')
  await expect(insertUser(pool, 'u1')).rejects.toMatchObject({ errno: 1062 })
})

it('SELECT ... FOR UPDATE를 받아들인다', async () => {
  await insertUser(pool, 'u1')
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? FOR UPDATE', [
    'u1',
  ])
  expect(rows).toHaveLength(1)
})

it('커밋한 트랜잭션은 남는다', async () => {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  await insertUser(conn, 'u1')
  await conn.commit()
  conn.release()
  conn.release() // 두 번 돌려줘도 잠금을 두 번 풀지 않는다.

  const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users')
  expect(rows[0]?.n).toBe(1)
})

it('제약 위반마다 mysql2의 errno로 바꿔 던진다', async () => {
  const insert = (id: unknown, nickname: unknown) =>
    pool.query('INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      id,
      nickname,
      new Date(0),
      new Date(0),
    ])
  await expect(insert('u1', undefined)).rejects.toMatchObject({ errno: 1048 }) // NOT NULL
  await expect(insert('u1', 'x'.repeat(21))).rejects.toMatchObject({ errno: 3819 }) // 길이 CHECK
  await expect(
    pool.query(
      'INSERT INTO social_accounts (user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?)',
      ['ghost', 'KAKAO', '1', new Date(0)],
    ),
  ).rejects.toMatchObject({ errno: 1452 }) // FK
})

it('제약 위반이 아닌 오류는 errno 없이 그대로 던진다', async () => {
  await expect(pool.query('SELECT * FROM nowhere')).rejects.not.toHaveProperty('errno')
})

it('boolean 파라미터는 0/1로 적는다', async () => {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT ? AS t, ? AS f', [true, false])
  expect(rows[0]).toEqual({ t: 1, f: 0 })
})

/** 잠금이 풀렸는지 — 풀리지 않았으면 질의가 영원히 기다리므로 시간 상한을 걸어 본다. */
const queryWithin = async (target: typeof pool, ms: number): Promise<'ok' | 'stuck'> =>
  Promise.race([
    target.query('SELECT 1').then(() => 'ok' as const),
    new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), ms)),
  ])

it('SQLite가 이미 끝낸 트랜잭션을 돌려줘도 잠금이 풀린다', async () => {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  await insertUser(conn, 'u1')
  // COMMIT 실패(SQLITE_FULL 등)로 SQLite가 스스로 되돌린 상황을 만든다 — 어댑터는 모른다.
  await conn.query('ROLLBACK')
  await expect(conn.rollback()).rejects.toThrow(/no transaction/)
  conn.release()

  expect(await queryWithin(pool, 1_000)).toBe('ok')
})

it('되돌리지 않은 채 release에서 ROLLBACK이 실패해도 잠금이 풀린다', async () => {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  await conn.query('ROLLBACK')
  expect(() => conn.release()).not.toThrow()

  expect(await queryWithin(pool, 1_000)).toBe('ok')
})

it('지연된 FK 위반으로 COMMIT이 실패하면 되돌리고 다음 질의로 계속 간다', async () => {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  await conn.query('PRAGMA defer_foreign_keys = ON')
  await conn.query(
    'INSERT INTO social_accounts (user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?)',
    ['ghost', 'KAKAO', '1', new Date(0)],
  )
  await expect(conn.commit()).rejects.toThrow(/FOREIGN KEY/)
  await conn.rollback()
  conn.release()

  const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM social_accounts')
  expect(rows[0]?.n).toBe(0)
})

it('열다 실패한 DB 핸들을 남기지 않는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yorr-sqlite-bad-'))
  const path = join(dir, 'not-a-db.sqlite')
  writeFileSync(path, 'this is not a sqlite database file at all, just text '.repeat(200))
  const broken = createSqlitePool(path)
  const openFds = (): number => readdirSync('/proc/self/fd').length
  try {
    await expect(broken.query('SELECT 1')).rejects.toThrow()
    const before = openFds()
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await expect(broken.query('SELECT 1')).rejects.toThrow(/not a database/)
    }
    expect(openFds()).toBeLessThanOrEqual(before)
  } finally {
    await broken.end()
    rmSync(dir, { recursive: true, force: true })
  }
})
