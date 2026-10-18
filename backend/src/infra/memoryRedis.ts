import type { Redis } from 'ioredis'
import RedisMock from 'ioredis-mock'

/**
 * 프로세스 안에서 도는 Redis — Botkeep 단일 프로세스 배포용(deploy/botkeep/README.md).
 *
 * Botkeep 무료 플랜은 서버 슬롯이 하나이고 DB도 슬롯을 하나 차지하므로 `redis-server`를
 * 따로 띄울 수 없다. ioredis-mock은 Lua(fengari)까지 구현해서 기존 스크립트와 Redis 통합
 * 스위트가 그대로 통과한다(`REDIS_TEST_DRIVER=mock`).
 *
 * 한계 하나를 여기서 메운다: ioredis-mock은 만료된 키를 **다시 조회할 때만** 지운다.
 * 아무도 다시 보지 않는 방·세션 키가 영원히 남으므로, 만료를 건 키를 따로 기억했다가
 * 주기적으로 한 번씩 건드려 회수한다.
 *
 * 영속화는 없다 — 재시작하면 진행 중인 방·게스트 세션이 사라진다. 회원·전적은 SQLite에 있다.
 */
export interface MemoryRedis {
  readonly redis: Redis
  /** 지금 회수를 한 번 돌린다(테스트용). 회수한 키 수를 돌려준다. */
  sweep(): number
  stop(): void
}

interface MockExpires {
  set(key: string, timestamp: number): void
  has(key: string): boolean
  isExpired(key: string): boolean
}

interface MockInternals {
  readonly expires: MockExpires
  readonly data: { has(key: string): boolean }
}

export const createMemoryRedis = (sweepIntervalMs = 60_000): MemoryRedis => {
  const redis = new RedisMock() as unknown as Redis
  const { expires, data } = redis as unknown as MockInternals
  const tracked = new Set<string>()

  const originalSet = expires.set.bind(expires)
  expires.set = (key, timestamp) => {
    tracked.add(key)
    originalSet(key, timestamp)
  }

  const sweep = (): number => {
    let reclaimed = 0
    for (const key of tracked) {
      if (!expires.has(key)) {
        // PERSIST·DEL·덮어쓰기로 만료가 풀렸다 — 더 볼 필요가 없다.
        tracked.delete(key)
      } else if (expires.isExpired(key)) {
        data.has(key) // 조회가 곧 삭제다(ioredis-mock의 지연 만료).
        tracked.delete(key)
        reclaimed += 1
      }
    }
    return reclaimed
  }

  const timer = setInterval(sweep, sweepIntervalMs)
  timer.unref()
  return {
    redis,
    sweep,
    stop: () => clearInterval(timer),
  }
}
