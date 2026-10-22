/** 정렬 집합 명령. 정렬 규칙은 점수 오름차순, 동점이면 멤버 사전순(Redis와 같다). */

import { dropIfEmpty, type RedisKeyspace } from './redisKeyspace.js'
import type { Field } from './redisTypes.js'
import { integer, parseScoreBound } from './redisTypes.js'

export function zadd(store: RedisKeyspace, key: string, args: readonly Field[]): number {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error("ERR wrong number of arguments for 'zadd' command")
  }
  const pairs = toScoredMembers(args)
  let zset = store.zset(key)
  if (zset === undefined) {
    zset = new Map()
    store.create(key, { type: 'zset', value: zset })
  }
  let added = 0
  for (const [score, member] of pairs) {
    if (!zset.has(member)) added += 1
    zset.set(member, score)
  }
  return added
}

function toScoredMembers(args: readonly Field[]): [number, string][] {
  const pairs: [number, string][] = []
  for (let i = 0; i < args.length; i += 2) {
    const score = Number(args[i])
    if (Number.isNaN(score)) throw new Error('ERR value is not a valid float')
    pairs.push([score, String(args[i + 1])])
  }
  return pairs
}

/** Redis `ZRANGE`의 색인 규칙 그대로: 음수는 끝에서, 범위를 벗어나면 잘라내고, 비면 []. */
export function zrange(store: RedisKeyspace, key: string, start: Field, stop: Field): string[] {
  const members = sortedMembers(store, key)
  const { from, to } = clampRange(members.length, integer(start), integer(stop))
  return from > to ? [] : members.slice(from, to + 1)
}

function clampRange(length: number, start: number, stop: number) {
  let from = start < 0 ? start + length : start
  let to = stop < 0 ? stop + length : stop
  if (from < 0) from = 0
  if (to >= length) to = length - 1
  return { from, to }
}

function sortedMembers(store: RedisKeyspace, key: string): string[] {
  const zset = store.zset(key)
  if (zset === undefined) return []
  return [...zset.entries()]
    .sort(([a, scoreA], [b, scoreB]) => scoreA - scoreB || (a < b ? -1 : a > b ? 1 : 0))
    .map(([member]) => member)
}

export function zrem(store: RedisKeyspace, key: string, members: readonly Field[]): number {
  const zset = store.zset(key)
  if (zset === undefined) return 0
  let removed = 0
  for (const member of members) if (zset.delete(String(member))) removed += 1
  dropIfEmpty(store, key, zset)
  return removed
}

export function zremrangebyscore(
  store: RedisKeyspace,
  key: string,
  min: Field,
  max: Field,
): number {
  const zset = store.zset(key)
  if (zset === undefined) return 0
  const low = parseScoreBound(min)
  const high = parseScoreBound(max)
  let removed = 0
  for (const [member, score] of zset) {
    if (score >= low && score <= high) {
      zset.delete(member)
      removed += 1
    }
  }
  dropIfEmpty(store, key, zset)
  return removed
}
