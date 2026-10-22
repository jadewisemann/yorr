/** 해시 명령. 빈 해시는 키째 사라진다(Redis와 같다). */

import { dropIfEmpty, type RedisKeyspace } from './redisKeyspace.js'
import type { Field } from './redisTypes.js'
import { integer } from './redisTypes.js'

/** `HSET key field value [field value ...]` 또는 `HSET key { field: value }` → 새로 생긴 필드 수. */
export function hset(
  store: RedisKeyspace,
  key: string,
  args: readonly (Field | Record<string, Field>)[],
): number {
  const pairs = toPairs(args)
  const hash = store.hashForWrite(key)
  let added = 0
  for (const [field, value] of pairs) {
    if (!hash.has(field)) added += 1
    hash.set(field, value)
  }
  return added
}

function toPairs(args: readonly (Field | Record<string, Field>)[]): [string, string][] {
  const [first] = args
  if (args.length === 1 && typeof first === 'object' && first !== null) {
    return Object.entries(first).map(([field, value]) => [field, String(value)])
  }
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error("ERR wrong number of arguments for 'hset' command")
  }
  const pairs: [string, string][] = []
  for (let i = 0; i < args.length; i += 2) {
    pairs.push([String(args[i]), String(args[i + 1])])
  }
  return pairs
}

export function hget(store: RedisKeyspace, key: string, field: Field): string | null {
  return store.hash(key)?.get(String(field)) ?? null
}

export function hgetall(store: RedisKeyspace, key: string): Record<string, string> {
  return Object.fromEntries(store.hash(key) ?? [])
}

export function hdel(store: RedisKeyspace, key: string, fields: readonly Field[]): number {
  const hash = store.hash(key)
  if (hash === undefined) return 0
  let removed = 0
  for (const field of fields) if (hash.delete(String(field))) removed += 1
  dropIfEmpty(store, key, hash)
  return removed
}

export function hexists(store: RedisKeyspace, key: string, field: Field): number {
  return store.hash(key)?.has(String(field)) ? 1 : 0
}

export function hlen(store: RedisKeyspace, key: string): number {
  return store.hash(key)?.size ?? 0
}

export function hkeys(store: RedisKeyspace, key: string): string[] {
  return [...(store.hash(key)?.keys() ?? [])]
}

export function hincrby(store: RedisKeyspace, key: string, field: Field, increment: Field): number {
  // 인자부터 본다 — 틀린 인자로 빈 해시가 생기면 안 된다.
  const step = integer(increment)
  const hash = store.hashForWrite(key)
  const current = Number(hash.get(String(field)) ?? '0')
  if (!Number.isInteger(current)) throw new Error('ERR hash value is not an integer')
  const next = current + step
  hash.set(String(field), String(next))
  return next
}
