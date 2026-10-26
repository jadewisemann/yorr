/**
 * 동기 명령 집합. 원자적 스크립트(`AtomicScript.run`)가 이것을 받는다.
 *
 * 여기 있는 메서드는 전부 **동기**다 — `runAtomic`이 `await` 없이 돌아야 그 사이에 다른 명령이
 * 끼어들지 않는다(DESIGN.md 원칙 7). 비동기 겉면은 [`memoryRedis.ts`](./memoryRedis.ts)의
 * `MemoryRedis`가 씌운다.
 *
 * 구현은 넷으로 나뉜다.
 * - [`redisTypes.ts`](./redisTypes.ts) — 값 모델·상수·스냅샷 파서
 * - [`redisKeyspace.ts`](./redisKeyspace.ts) — 상태와 만료·상한·스크립트 선언 규칙
 * - [`redisStrings.ts`](./redisStrings.ts) · [`redisHashes.ts`](./redisHashes.ts) ·
 *   [`redisZsets.ts`](./redisZsets.ts) — 타입별 명령
 * - 이 파일 — 그것을 묶는 명령 표면(스크립트가 아는 이름 그대로)
 */

import { hdel, hexists, hget, hgetall, hincrby, hkeys, hlen, hset } from './redisHashes.js'
import { del, exists, expire, flushall, keys, pexpire, pttl, ttl } from './redisKeyCommands.js'
import { RedisKeyspace } from './redisKeyspace.js'
import { get, getdel, set } from './redisStrings.js'
import type { Field, SnapshotEntry } from './redisTypes.js'
import { zadd, zrange, zrem, zremrangebyscore } from './redisZsets.js'

export class RedisCore {
  private readonly store: RedisKeyspace

  constructor(now: () => number = Date.now, maxKeys?: number) {
    this.store = new RedisKeyspace(now, maxKeys)
  }

  runAdmitted<R>(script: string, creatable: readonly string[], run: () => R): R {
    return this.store.runAdmitted(script, creatable, run)
  }

  snapshot(): SnapshotEntry[] {
    return this.store.snapshot()
  }

  restore(raw: readonly unknown[]): number {
    return this.store.restore(raw)
  }

  sweep(): number {
    return this.store.sweep()
  }

  // ── 키 ────────────────────────────────────────────────────────────────────

  exists(...keys: string[]): number {
    return exists(this.store, keys)
  }

  del(...keys: string[]): number {
    return del(this.store, keys)
  }

  pexpire(key: string, milliseconds: Field): number {
    return pexpire(this.store, key, milliseconds)
  }

  expire(key: string, seconds: Field): number {
    return expire(this.store, key, seconds)
  }

  pttl(key: string): number {
    return pttl(this.store, key)
  }

  ttl(key: string): number {
    return ttl(this.store, key)
  }

  keys(pattern = '*'): string[] {
    return keys(this.store, pattern)
  }

  flushall(): 'OK' {
    return flushall(this.store)
  }

  // ── 문자열 ────────────────────────────────────────────────────────────────

  get(key: string): string | null {
    return get(this.store, key)
  }

  set(key: string, value: Field, ...options: Field[]): 'OK' | null {
    return set(this.store, key, value, options)
  }

  getdel(key: string): string | null {
    return getdel(this.store, key)
  }

  // ── 해시 ──────────────────────────────────────────────────────────────────

  hset(key: string, ...args: (Field | Record<string, Field>)[]): number {
    return hset(this.store, key, args)
  }

  hget(key: string, field: Field): string | null {
    return hget(this.store, key, field)
  }

  hgetall(key: string): Record<string, string> {
    return hgetall(this.store, key)
  }

  hdel(key: string, ...fields: Field[]): number {
    return hdel(this.store, key, fields)
  }

  hexists(key: string, field: Field): number {
    return hexists(this.store, key, field)
  }

  hlen(key: string): number {
    return hlen(this.store, key)
  }

  hkeys(key: string): string[] {
    return hkeys(this.store, key)
  }

  hincrby(key: string, field: Field, increment: Field): number {
    return hincrby(this.store, key, field, increment)
  }

  // ── 정렬 집합 ─────────────────────────────────────────────────────────────

  zadd(key: string, ...args: Field[]): number {
    return zadd(this.store, key, args)
  }

  zrange(key: string, start: Field, stop: Field): string[] {
    return zrange(this.store, key, start, stop)
  }

  zrem(key: string, ...members: Field[]): number {
    return zrem(this.store, key, members)
  }

  zremrangebyscore(key: string, min: Field, max: Field): number {
    return zremrangebyscore(this.store, key, min, max)
  }
}
