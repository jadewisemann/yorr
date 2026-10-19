import { existsSync } from 'node:fs'
import { loadEnv } from './config/env.js'
import { MemoryRedis } from './infra/memoryRedis.js'
import { closeDbPool, createDbPool } from './infra/sqlite.js'
import { loadStoreSnapshot, saveStoreSnapshotIfChanged } from './infra/storeSnapshot.js'
import { createServer } from './server.js'

if (existsSync('.env')) process.loadEnvFile('.env')

const env = loadEnv()
// 풀과 저장소는 여기서 만들어 `createServer`에 넘긴다 — 주입한 쪽이 닫는 규약이므로 종료 훅도
// 여기 있다. 저장소는 `listen()`의 부팅 재무장보다 **먼저** 스냅샷을 들여야 한다.
const db = createDbPool(env)
const redis = new MemoryRedis()
const snapshotPath = env.STORE_SNAPSHOT_PATH.trim()
const loaded = snapshotPath === '' ? null : loadStoreSnapshot(redis, snapshotPath)
const server = await createServer(env, { db, redis })

if (loaded?.kind === 'restored') {
  server.app.log.info({ entries: loaded.entries }, '저장소 스냅샷을 들였습니다')
} else if (loaded?.kind === 'corrupt') {
  server.app.log.error(
    { error: loaded.error, movedTo: loaded.movedTo },
    '저장소 스냅샷이 손상돼 빈 저장소로 시작합니다',
  )
}

/** 저장이 이보다 오래 걸리면 경고로 남긴다 — 그만큼 이벤트 루프가 멈췄다는 뜻이다. */
const SLOW_SNAPSHOT_MS = 100

const saveSnapshot = (): void => {
  if (snapshotPath === '') return
  try {
    const result = saveStoreSnapshotIfChanged(redis, snapshotPath)
    if (result.kind === 'written') {
      const level = result.ms >= SLOW_SNAPSHOT_MS ? 'warn' : 'debug'
      server.app.log[level](result, '저장소 스냅샷을 썼습니다')
    }
  } catch (error) {
    // 쓰기 실패가 서버를 죽이지 않는다 — 다음 주기에 다시 쓴다.
    server.app.log.error({ error }, '저장소 스냅샷을 쓰지 못했습니다')
  }
}
const snapshotTimer = setInterval(saveSnapshot, env.STORE_SNAPSHOT_INTERVAL_MS)
snapshotTimer.unref()

const shutdown = async (signal: string): Promise<void> => {
  server.app.log.info({ signal }, '서버를 종료합니다')
  clearInterval(snapshotTimer)
  await server.close()
  // 서버를 닫은 **뒤에** 쓴다 — 마지막 요청까지 반영된 상태가 남는다.
  saveSnapshot()
  redis.disconnect()
  await closeDbPool(db)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await server.listen()
