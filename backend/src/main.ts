import { existsSync } from 'node:fs'
import { loadEnv } from './config/env.js'
import { closeDbPool, createDbPool } from './infra/sqlite.js'
import { createServer } from './server.js'

if (existsSync('.env')) process.loadEnvFile('.env')

const env = loadEnv()
// 풀은 여기서 만들어 `createServer`에 넘긴다 — 주입한 쪽이 닫는 규약이므로 종료 훅도 여기 있다.
const db = createDbPool(env)
const server = await createServer(env, { db })

const shutdown = async (signal: string): Promise<void> => {
  server.app.log.info({ signal }, '서버를 종료합니다')
  await server.close()
  await closeDbPool(db)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await server.listen()
