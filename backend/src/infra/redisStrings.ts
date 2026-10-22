/** 문자열 명령. 저장 규칙·타입 검사는 [`redisKeyspace.ts`](./redisKeyspace.ts)가 진다. */

import type { RedisKeyspace } from './redisKeyspace.js'
import type { Entry, Field } from './redisTypes.js'
import { integer } from './redisTypes.js'

export function get(store: RedisKeyspace, key: string): string | null {
  return store.string(key)
}

/** `SET key value [EX s | PX ms] [NX | XX]` → 'OK' · 조건 불충족이면 null. TTL은 새로 정한다. */
export function set(
  store: RedisKeyspace,
  key: string,
  value: Field,
  options: readonly Field[],
): 'OK' | null {
  const { expiresAt, condition } = parseSetOptions(store, options)
  const exists = store.live(key) !== undefined
  if ((condition === 'NX' && exists) || (condition === 'XX' && !exists)) return null
  const entry: Entry = { type: 'string', value: String(value), expiresAt }
  if (exists) store.data.set(key, entry)
  else store.create(key, entry)
  return 'OK'
}

function parseSetOptions(
  store: RedisKeyspace,
  options: readonly Field[],
): { expiresAt: number | undefined; condition: 'NX' | 'XX' | null } {
  let expiresAt: number | undefined
  let condition: 'NX' | 'XX' | null = null
  for (let i = 0; i < options.length; i += 1) {
    const option = String(options[i]).toUpperCase()
    if (option === 'EX' || option === 'PX') {
      const amount = integer(options[i + 1] ?? '')
      i += 1
      expiresAt = store.now() + (option === 'EX' ? amount * 1000 : amount)
    } else if (option === 'NX' || option === 'XX') {
      condition = option
    } else {
      throw new Error(`지원하지 않는 SET 옵션: ${option}`)
    }
  }
  return { expiresAt, condition }
}

export function getdel(store: RedisKeyspace, key: string): string | null {
  const value = store.string(key)
  if (value !== null) store.data.delete(key)
  return value
}
