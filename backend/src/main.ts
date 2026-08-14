import { existsSync } from 'node:fs'
import { loadEnv } from './config/env.js'
import { createServer } from './server.js'

if (existsSync('.env')) process.loadEnvFile('.env')

const env = loadEnv()
const server = await createServer(env)

const shutdown = async (signal: string): Promise<void> => {
  server.app.log.info({ signal }, '서버를 종료합니다')
  await server.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await server.listen()
