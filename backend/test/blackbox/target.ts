import type { AddressInfo } from 'node:net'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe } from 'vitest'
import { loadEnv } from '../../src/config/env.js'
import { createServer, type YorrServer } from '../../src/server.js'
import { redisTestsEnabled, startRedisServer } from '../redisHarness.js'

/**
 * 블랙박스 스위트가 두드릴 서버. **두 모드가 같은 테스트를 돌린다.**
 *
 * - `in-process`(기본): 이 프로세스에 진짜 서버를 띄운다 — 진짜 포트, 진짜 redis-server.
 *   REST는 `app.inject`가 아니라 `fetch`로, WS는 진짜 소켓으로 간다.
 * - `external`: `E2E_BASE_URL`의 서버. 배포 리허설이 CI에서 띄운 **실제 이미지·compose·
 *   프록시**를 그대로 두드린다(SQLite의 "test what you fly": 출하하는 산출물을 시험한다).
 *
 * 테스트는 서로의 방을 건드리지 않는다(방마다 새 코드). 그래서 한 서버를 파일 안의 모든
 * 테스트가 공유해도 되고, FLUSHALL도 하지 않는다 — 살아 있는 서버 밑에서 저장소를 지우는
 * 것은 운영에서 일어나지 않는 일이다.
 */
export type TargetMode = 'in-process' | 'external'

export interface ServerLogLine {
  readonly level: number
  readonly msg?: string
  readonly [field: string]: unknown
}

export interface Target {
  readonly mode: TargetMode
  /** `http://127.0.0.1:PORT` 꼴. 경로는 붙이지 않는다. */
  readonly httpBase: string
  readonly wsUrl: string
  /** in-process 전용 — 서버가 남긴 로그. external이면 비어 있다(컨테이너 로그는 CI가 본다). */
  readonly logs: readonly ServerLogLine[]
  /** in-process 전용 흰 상자 창. 누수 검사 같은 곳에만 쓰고 동작 단정에는 쓰지 않는다. */
  readonly inProcess: YorrServer | undefined
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export const targetMode: TargetMode = process.env.E2E_BASE_URL?.trim() ? 'external' : 'in-process'

/** in-process 모드는 redis-server가 있어야 돈다. CI는 `REDIS_TEST_REQUIRED=1`로 건너뜀을 막는다. */
export const describeTarget =
  targetMode === 'external' || redisTestsEnabled ? describe : describe.skip

/**
 * external 주소. **운영을 두드리지 않도록 루프백만 받는다** — 퍼저와 장애 시나리오가 같은
 * 스위트에 있으므로 이 검사가 곧 운영 보호막이다.
 */
const externalTarget = (raw: string): Target => {
  const base = new URL(raw)
  if (!LOOPBACK_HOSTS.has(base.hostname) && process.env.E2E_ALLOW_REMOTE !== '1') {
    throw new Error(
      `E2E_BASE_URL은 루프백 주소만 받는다(운영 보호): ${base.hostname}. ` +
        '정말 원격을 두드려야 하면 E2E_ALLOW_REMOTE=1을 함께 준다.',
    )
  }
  const wsScheme = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return {
    mode: 'external',
    httpBase: base.origin,
    wsUrl: `${wsScheme}//${base.host}/ws/v1/game`,
    logs: [],
    inProcess: undefined,
  }
}

export interface InProcessTarget {
  readonly target: Target
  stop(): Promise<void>
}

/**
 * 주어진 Redis 클라이언트로 이 프로세스에 진짜 서버를 띄운다(빈 포트, 로그 수집).
 * `stop()`은 서버만 닫는다 — 클라이언트는 넘긴 쪽이 닫는다. 장애 주입 테스트가 가짜가 아닌
 * **감싼** 클라이언트(`test/faults/faultyRedis.ts`)를 넘기는 자리다.
 */
export const serveInProcess = async (redis: Redis): Promise<InProcessTarget> => {
  const logs: ServerLogLine[] = []
  // 포트 0 = 빈 포트 자동 할당. 스킴은 양수만 받으므로(운영 계약) 여기서만 덮어쓴다.
  const env = { ...loadEnv({ CORS_ALLOWED_ORIGINS: 'https://yorr.site' }), SERVER_PORT: 0 }
  const server = await createServer(env, {
    redis,
    logger: {
      level: 'info',
      stream: { write: (line: string) => logs.push(JSON.parse(line) as ServerLogLine) },
    },
  })
  await server.listen()
  const { port } = server.app.server.address() as AddressInfo
  return {
    target: {
      mode: 'in-process',
      httpBase: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}/ws/v1/game`,
      logs,
      inProcess: server,
    },
    stop: () => server.close(),
  }
}

/**
 * 이 프로세스에 진짜 서버 하나 — 자기 redis-server까지. `stop()`은 서버를 닫고 Redis까지
 * 내린다(누수 검사가 "시작 전과 같은 상태로 돌아왔는가"를 본다).
 */
export const startInProcessTarget = async (): Promise<InProcessTarget> => {
  const redisServer = await startRedisServer()
  const redis = new Redis({ path: redisServer.socketPath })
  // `server.close()`는 끊긴 소켓들의 정리 작업이 끝나기를 기다리지 않는다. 그 꼬리가
  // 내린 Redis에 쓰다 나는 EPIPE는 정리 순서의 부산물이므로 콘솔에 찍지 않는다.
  redis.on('error', () => {})
  const served = await serveInProcess(redis)
  return {
    target: served.target,
    stop: async () => {
      await served.stop()
      await redis.quit().catch(() => redis.disconnect())
      redisServer.stop()
    },
  }
}

/** 파일 하나가 쓸 서버를 준비한다. 반환된 함수는 `beforeAll` 이후(테스트 본문)에서 부른다. */
export const useTarget = (): (() => Target) => {
  let target: Target | undefined
  let stop: (() => Promise<void>) | undefined

  beforeAll(async () => {
    const external = process.env.E2E_BASE_URL?.trim()
    if (external) {
      target = externalTarget(external)
      return
    }
    const started = await startInProcessTarget()
    target = started.target
    stop = started.stop
  }, 60_000)

  afterAll(async () => {
    await stop?.()
  })

  return () => {
    if (!target) throw new Error('useTarget(): beforeAll 이전에는 대상 서버가 없다')
    return target
  }
}

/**
 * 핸들러 밖으로 새어 나와 게이트웨이가 삼킨 예외(= 버그). 게이트웨이는 소켓을 살려 두려고
 * 이것을 로그로만 남기므로, 로그를 보지 않으면 **초록 뒤에 숨는다.**
 */
export const escapedHandlerErrors = (target: Target): readonly ServerLogLine[] =>
  target.logs.filter((line) => line.msg === 'WS 메시지 처리 실패')
