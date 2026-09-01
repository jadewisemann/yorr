import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe } from 'vitest'

/**
 * Redis 통합 테스트 하네스 — ADR-0004.
 *
 * Lua 원자성·TTL·동시성은 모킹으로 검증할 수 없으므로 진짜 Redis가 필요하다.
 * 기본 전략은 **테스트 파일마다 로컬 `redis-server`를 유닉스 소켓으로 하나씩**
 * 띄우는 것이다(포트 충돌 없음, 파일 간 격리 = vitest 병렬 실행과 양립).
 * `REDIS_TEST_URL`이 있으면 그 서버를 대신 쓴다(CI의 service container 등).
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL

const hasRedisServerBinary = (): boolean =>
  spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0

export const redisTestsEnabled = Boolean(REDIS_TEST_URL) || hasRedisServerBinary()

// CI는 이 값을 켜서 "조용히 건너뛴 초록"을 막는다 — operations.md 참고.
if (!redisTestsEnabled && process.env.REDIS_TEST_REQUIRED === '1') {
  throw new Error('REDIS_TEST_REQUIRED=1인데 redis-server 바이너리도 REDIS_TEST_URL도 없다')
}

/** Redis가 없는 환경에서는 통합 스위트를 건너뛴다(단위 테스트는 계속 돈다). */
export const describeRedis = redisTestsEnabled ? describe : describe.skip

interface RedisServerHandle {
  readonly socketPath: string
  stop(): void
}

const startRedisServer = async (): Promise<RedisServerHandle> => {
  const dir = mkdtempSync(join(tmpdir(), 'yorr-redis-'))
  const socketPath = join(dir, 'r.sock')
  // port 0 = TCP 미개방. 영속화도 끈다 — 테스트마다 깨끗한 인메모리 인스턴스.
  const child: ChildProcess = spawn(
    'redis-server',
    ['--port', '0', '--unixsocket', socketPath, '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' },
  )
  const stop = (): void => {
    child.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      stop()
      throw new Error(`redis-server가 기동 중 종료됐다(exit ${child.exitCode})`)
    }
    const probe = new Redis({ path: socketPath, lazyConnect: true, retryStrategy: () => null })
    try {
      await probe.connect()
      await probe.ping()
      probe.disconnect()
      return { socketPath, stop }
    } catch {
      probe.disconnect()
      await delay(50)
    }
  }
  stop()
  throw new Error('redis-server가 5초 안에 준비되지 않았다')
}

/**
 * 테스트 파일 하나가 쓸 Redis 클라이언트를 준비한다. 반환된 함수는 `beforeAll`
 * 이후에만 호출한다(테스트 본문에서 `redis()`).
 *
 * 매 테스트 전에 FLUSHALL로 격리한다.
 */
export const useRedis = (): (() => Redis) => {
  let server: RedisServerHandle | undefined
  let client: Redis | undefined

  beforeAll(async () => {
    if (REDIS_TEST_URL) {
      client = new Redis(REDIS_TEST_URL)
    } else {
      server = await startRedisServer()
      client = new Redis({ path: server.socketPath })
    }
    await client.ping()
  }, 30_000)

  beforeEach(async () => {
    await client?.flushall()
  })

  afterAll(async () => {
    await client?.quit().catch(() => client?.disconnect())
    server?.stop()
  })

  return () => {
    if (!client) throw new Error('useRedis(): beforeAll 이전에는 클라이언트가 없다')
    return client
  }
}
