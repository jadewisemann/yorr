import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { describeDb, useDb } from '../../infra/__tests__/dbHarness.js'
import type { Redis } from '../../infra/memoryRedis.js'
import type { Pool } from '../../infra/sqlite.js'
import {
  dbReadinessCheck,
  type ReadinessDb,
  type ReadinessRedis,
  ReadinessService,
  redisReadinessCheck,
} from '../readiness.js'

/**
 * readiness의 좁은 포트가 **진짜 클라이언트로 그대로 만족되는지** 고정한다.
 *
 * 어댑터를 두지 않았으므로(다른 포트들과 같은 판단 — `game/round/__tests__/
 * roundPorts.contract.test.ts` 참고) 시그니처가 어긋나면 배선하는 순간, 즉
 * `server.ts`에서야 터진다. 게다가 이 배선의 실패는 조용하다: health가 항상 503이면
 * 배포가 막히지만 **왜 막히는지는 로그를 읽어야 안다.** 그 창을 여기서 없앤다.
 *
 * 아래 두 검사는 대입 가능성만 보는 것이 아니라 **실제로 왕복을 낸다** — `ping`이
 * 있다는 사실과 `ping`이 응답한다는 사실은 다르고, readiness가 증명해야 하는 것은
 * 후자다.
 */
describeRedis('readiness 포트 ↔ MemoryRedis', () => {
  const redis = useRedis()

  it('Redis가 ReadinessRedis를 만족하고 PING이 실제로 돌아온다', async () => {
    const real: Redis = redis()
    const port: ReadinessRedis = real

    await expect(port.ping()).resolves.toBe('PONG')
    await expect(new ReadinessService([redisReadinessCheck(real)]).check()).resolves.toEqual({
      ready: true,
      failures: [],
    })
  })
})

describeDb('readiness 포트 ↔ SQLite Pool', () => {
  const db = useDb()

  it('Pool이 ReadinessDb을 만족하고 SELECT 1이 실제로 돌아온다', async () => {
    const real: Pool = db()
    const port: ReadinessDb = real

    await expect(port.query('SELECT 1')).resolves.toBeDefined()
    await expect(new ReadinessService([dbReadinessCheck(real)]).check()).resolves.toEqual({
      ready: true,
      failures: [],
    })
  })
})
