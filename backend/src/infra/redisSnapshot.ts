/** 스냅샷·만료 회수. 상태 자체는 [`redisKeyspace.ts`](./redisKeyspace.ts)가 가진다. */
import type { RedisKeyspace } from './redisKeyspace.js'
import { OOM_MESSAGE, parseEntry, type SnapshotEntry } from './redisTypes.js'

/** 살아 있는 키 전부를 스냅샷 줄로. 만료된 키는 싣지 않는다. */
export function snapshotOf(store: RedisKeyspace): SnapshotEntry[] {
  const now = store.now()
  const entries: SnapshotEntry[] = []
  for (const [k, entry] of store.data) {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) continue
    const e = entry.expiresAt === undefined ? {} : { e: entry.expiresAt }
    if (entry.type === 'string') entries.push({ k, t: 's', v: entry.value, ...e })
    else if (entry.type === 'hash') entries.push({ k, t: 'h', v: [...entry.value], ...e })
    else entries.push({ k, t: 'z', v: [...entry.value], ...e })
  }
  return entries
}

/**
 * 스냅샷을 **빈 저장소에** 들인다(기동 시 한 번). 모양을 먼저 전부 검사하고 나서 쓰므로, 틀린
 * 줄이 하나라도 있으면 아무것도 들이지 않고 던진다. 그 사이 만료된 키는 버린다. 들인 수를 돌려준다.
 */
export function restoreInto(store: RedisKeyspace, raw: readonly unknown[]): number {
  if (store.data.size > 0) throw new Error('스냅샷은 빈 저장소에만 들인다')
  const now = store.now()
  const live = raw
    .map(parseEntry)
    // 그 사이 만료된 키와, 빈 해시·정렬 집합(Redis에는 없는 상태)은 버린다. 빈 문자열은 값이다.
    .filter((entry) => entry.e === undefined || entry.e > now)
    .filter((entry) => entry.t === 's' || entry.v.length > 0)
  // 쓰기 전에 상한을 본다 — 중간에 OOM으로 멈춰 반쯤 들인 저장소가 남지 않게.
  if (live.length > store.capacity) throw new Error(OOM_MESSAGE)
  let restored = 0
  for (const entry of live) {
    const expiresAt = entry.e
    if (entry.t === 's') store.create(entry.k, { type: 'string', value: entry.v, expiresAt })
    else if (entry.t === 'h')
      store.create(entry.k, { type: 'hash', value: new Map(entry.v), expiresAt })
    else store.create(entry.k, { type: 'zset', value: new Map(entry.v), expiresAt })
    restored += 1
  }
  return restored
}

/** 만료된 키를 지금 지운다. 회수한 수를 돌려준다. */
export function sweepExpired(store: RedisKeyspace): number {
  const now = store.now()
  let reclaimed = 0
  for (const [key, entry] of store.data) {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      store.data.delete(key)
      reclaimed += 1
    }
  }
  return reclaimed
}
