/** 키 공간 명령(존재·삭제·만료·조회). 만료 시맨틱은 Redis와 같다. */
import type { RedisKeyspace } from './redisKeyspace.js'
import { type Field, globToRegExp, integer } from './redisTypes.js'

export function exists(store: RedisKeyspace, keys: readonly string[]): number {
  return keys.filter((key) => store.live(key) !== undefined).length
}

export function del(store: RedisKeyspace, keys: readonly string[]): number {
  let removed = 0
  for (const key of keys) {
    if (store.live(key) !== undefined) {
      store.data.delete(key)
      removed += 1
    }
  }
  return removed
}

/** 음수·0 TTL은 즉시 삭제다 — Redis처럼 1을 돌려준다. */
export function pexpire(store: RedisKeyspace, key: string, milliseconds: Field): number {
  const entry = store.live(key)
  if (entry === undefined) return 0
  const ms = integer(milliseconds)
  if (ms <= 0) {
    store.data.delete(key)
    return 1
  }
  entry.expiresAt = store.now() + ms
  return 1
}

export function expire(store: RedisKeyspace, key: string, seconds: Field): number {
  return pexpire(store, key, integer(seconds) * 1000)
}

export function pttl(store: RedisKeyspace, key: string): number {
  const entry = store.live(key)
  if (entry === undefined) return -2
  if (entry.expiresAt === undefined) return -1
  return entry.expiresAt - store.now()
}

export function ttl(store: RedisKeyspace, key: string): number {
  const ms = pttl(store, key)
  return ms < 0 ? ms : Math.round(ms / 1000)
}

export function keys(store: RedisKeyspace, pattern: string): string[] {
  const matcher = globToRegExp(pattern)
  return [...store.data.keys()].filter((key) => store.live(key) !== undefined && matcher.test(key))
}

export function flushall(store: RedisKeyspace): 'OK' {
  store.data.clear()
  return 'OK'
}
