import { afterAll, beforeAll, beforeEach, describe } from 'vitest'
import { MemoryRedis } from '../src/infra/memoryRedis.js'

/**
 * Redis 통합 테스트 하네스 — ADR-0004의 자리를 ADR-0007이 이어받았다.
 *
 * Redis 서버는 이제 없다. 운영과 **같은** 인프로세스 저장소(`MemoryRedis`)를 테스트 파일마다
 * 하나씩 만들고, 매 테스트 전에 FLUSHALL로 격리한다. 바이너리도 소켓도 필요 없어 어디서나 돈다.
 */

/** 예전 `describeRedis`와 같은 자리. 이제 건너뛸 이유가 없다. */
export const describeRedis = describe

export const useRedis = (): (() => MemoryRedis) => {
  let client: MemoryRedis | undefined

  beforeAll(() => {
    client = new MemoryRedis()
  })

  beforeEach(async () => {
    await client?.flushall()
  })

  afterAll(() => {
    client?.disconnect()
  })

  return () => {
    if (!client) throw new Error('useRedis(): beforeAll 이전에는 클라이언트가 없다')
    return client
  }
}
