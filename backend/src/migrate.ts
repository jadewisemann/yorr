import { existsSync } from 'node:fs'
import { loadEnv } from './config/env.js'
import { runMigrations } from './infra/migrations/index.js'
import { closeMysqlPool, createMysqlPool } from './infra/mysql.js'

if (existsSync('.env')) process.loadEnvFile('.env')

const mysql = createMysqlPool(loadEnv())
try {
  const { applied, plan } = await runMigrations(mysql)
  console.log('applied:', applied.length === 0 ? '(없음 — 이미 최신)' : applied.join(', '))
  console.log('history:', plan.applied.map((entry) => entry.script).join(', '))
} finally {
  await closeMysqlPool(mysql)
}
