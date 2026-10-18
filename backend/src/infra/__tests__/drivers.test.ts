import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loadEnv } from '../../config/env.js'
import { runMigrations, verifyMigrations } from '../migrations/runner.js'
import { closeMysqlPool, createMysqlPool } from '../mysql.js'
import { createRedisClient } from '../redis.js'
import { isSqlitePool } from '../sqlite.js'

/** Botkeep 번들이 고르는 드라이버(ADR-0007)가 env 하나로 실제로 바뀌는지 본다. */
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('DB_DRIVER=sqlite면 SQLite 풀을 만들고 없는 디렉터리도 만든다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yorr-sqlite-'))
  dirs.push(dir)
  const path = join(dir, 'nested', 'yorr.db')

  const pool = createMysqlPool(loadEnv({ DB_DRIVER: 'sqlite', SQLITE_PATH: path }))

  expect(isSqlitePool(pool)).toBe(true)
  expect(existsSync(path)).toBe(true)
  await closeMysqlPool(pool)
})

it('SQLite 풀에는 Flyway 러너가 아무것도 하지 않는다', async () => {
  const pool = createMysqlPool(loadEnv({ DB_DRIVER: 'sqlite', SQLITE_PATH: ':memory:' }))

  expect((await verifyMigrations(pool)).plan.pending).toEqual([])
  expect((await runMigrations(pool)).applied).toEqual([])
  await closeMysqlPool(pool)
})

it('기본 DB 드라이버는 그대로 MySQL이다', async () => {
  const pool = createMysqlPool(loadEnv({}))

  expect(isSqlitePool(pool)).toBe(false)
  await closeMysqlPool(pool)
})

it('REDIS_DRIVER=memory면 서버 없이 바로 응답한다', async () => {
  const redis = createRedisClient(loadEnv({ REDIS_DRIVER: 'memory' }))

  expect(await redis.ping()).toBe('PONG')
  redis.disconnect()
})
