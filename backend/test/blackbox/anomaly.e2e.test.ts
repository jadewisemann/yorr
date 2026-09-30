import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type FaultMode, faultyRedis } from '../faults/faultyRedis.js'
import { iterationsFromEnv } from '../fuzz/prng.js'
import { type RedisServerHandle, redisTestsEnabled, startRedisServer } from '../redisHarness.js'
import { leaveAll, seatedRoom } from './players.js'
import { serveInProcess, type Target, targetMode } from './target.js'
import { setDefaultWaitMs } from './ws.js'
import { greedyStrategy, YachtGame } from './yachtDriver.js'

/**
 * 장애 주입 스윕 — "Redis 명령 **어느 하나**가 실패해도 프로세스는 죽지 않고, 장애가 걷히면
 * 서버는 온전히 다시 일한다."
 *
 * 한 여정(방 만들기 → 입장 → 시작 → 한 턴 굴리고 기록)이 내는 Redis 명령을 세고, 그 중
 * N번째 **하나만** 실패시킨 채 여정을 돌린다. 여정 자체는 실패해도 된다 — 장애는 장애다.
 * 대신 두 가지는 모든 N에서 성립해야 한다.
 *
 * 1. 처리되지 않은 promise 거부가 없다. Node는 그것을 만나면 **프로세스를 내린다** —
 *    Redis가 한 번 삐끗했다고 모든 방이 끊기는 경로다.
 * 2. 장애를 걷은 뒤 같은 서버로 새 여정이 끝까지 성공한다 — 망가진 전역 상태가 없다.
 *
 * PR에서는 `ANOMALY_STRIDE`(기본 4)칸씩 건너뛰며 돌고, 야간 실행이 1로 전수를 돈다.
 */
const describeInProcess =
  targetMode === 'in-process' && redisTestsEnabled ? describe : describe.skip

const journey = async (target: Target): Promise<void> => {
  const seats = await seatedRoom(target, 2)
  try {
    const game = new YachtGame(seats)
    const step = await game.start(target)
    if (step.kind === 'turn') await game.playTurn(step.turn, greedyStrategy)
  } finally {
    await leaveAll(seats)
  }
}

describeInProcess('Redis 장애 주입 스윕 (in-process)', () => {
  let redisServer: RedisServerHandle | undefined
  let raw: Redis | undefined
  const unhandled: string[] = []
  let current = 'setup'
  const recordUnhandled = (reason: unknown): void => {
    unhandled.push(`${current}: ${reason instanceof Error ? reason.message : String(reason)}`)
  }

  beforeAll(async () => {
    redisServer = await startRedisServer()
    raw = new Redis({ path: redisServer.socketPath })
    raw.on('error', () => {})
    process.on('unhandledRejection', recordUnhandled)
    // 장애 뒤에는 응답이 "오지 않는" 것이 정상이다 — 기다리는 시간을 줄여 스윕을 짧게 한다.
    setDefaultWaitMs(1_000)
  }, 60_000)

  afterAll(async () => {
    process.off('unhandledRejection', recordUnhandled)
    setDefaultWaitMs(5_000)
    await raw?.quit().catch(() => raw?.disconnect())
    redisServer?.stop()
  })

  it('여정의 N번째 Redis 명령 하나만 실패시켜도 프로세스가 살고, 걷히면 다시 일한다', async () => {
    const redis = raw as Redis
    const stride = iterationsFromEnv('ANOMALY_STRIDE', 4)

    // 장애 없이 한 번 — 몇 개의 명령을 지나가는지 센다.
    const probe = faultyRedis(redis)
    const dry = await serveInProcess(probe.client)
    await journey(dry.target)
    await dry.stop()
    const total = probe.calls()
    expect(total).toBeGreaterThan(20)

    const outcomes: string[] = []
    for (const mode of ['before', 'after'] satisfies FaultMode[]) {
      for (let nth = 1; nth <= total; nth += stride) {
        current = `${mode} #${nth}`
        await redis.flushall()
        const faults = faultyRedis(redis)
        const served = await serveInProcess(faults.client)
        faults.arm(nth, mode)
        const outcome = await journey(served.target).then(
          () => 'completed',
          () => 'failed',
        )
        faults.disarm()
        outcomes.push(`${current} ${faults.injected() ?? '(미도달)'} → ${outcome}`)

        await expect(journey(served.target), `${current} 뒤 복구 여정`).resolves.toBeUndefined()
        await served.stop()
      }
    }

    if (process.env.ANOMALY_VERBOSE === '1') console.info(`명령 ${total}개\n${outcomes.join('\n')}`)
    expect(unhandled, outcomes.join('\n')).toEqual([])
    // 주입이 실제로 일어났는지 — 여정이 N에 닿지 못하면 이 스윕은 연극이 된다. 주사위가
    // 서버 난수라 굴림 횟수(= 명령 수)가 판마다 조금씩 달라서, 끝자락 몇 칸은 닿지 않는다.
    const reached = outcomes.filter((line) => !line.includes('(미도달)')).length
    expect(reached / outcomes.length).toBeGreaterThan(0.9)
  }, 1_800_000)
})
