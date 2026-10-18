import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loadEnv } from '../../config/env.js'
import { closeDbPool, createDbPool } from '../sqlite.js'

/** env의 `SQLITE_PATH`가 실제 파일 위치를 정하고, 파일은 첫 질의 때 생긴다. */
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('첫 질의 때 없는 디렉터리까지 만들어 파일을 연다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yorr-sqlite-'))
  dirs.push(dir)
  const path = join(dir, 'nested', 'yorr.db')

  const pool = createDbPool(loadEnv({ SQLITE_PATH: path }))
  expect(existsSync(path)).toBe(false)

  await pool.query('SELECT 1')
  expect(existsSync(path)).toBe(true)
  await closeDbPool(pool)
})

it('닫았다가 다시 질의하면 같은 파일을 다시 연다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yorr-sqlite-'))
  dirs.push(dir)
  const pool = createDbPool(loadEnv({ SQLITE_PATH: join(dir, 'yorr.db') }))
  await pool.query('INSERT INTO users (id, nickname, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    'u1',
    'n',
    new Date(0),
    new Date(0),
  ])
  await closeDbPool(pool)

  const [rows] = await pool.query('SELECT id FROM users')
  expect(rows).toEqual([{ id: 'u1' }])
  await closeDbPool(pool)
})
