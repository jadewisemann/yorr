/**
 * 메모리 Redis의 값 모델·상수·파서.
 *
 * 명령 구현(`RedisCore`)과 ioredis 모양의 겉면(`MemoryRedis`)이 함께 쓰는 것만 여기 둔다.
 * 시맨틱 설명은 [`memoryRedis.ts`](./memoryRedis.ts) 머리말에 있다.
 */

export type Entry =
  | { type: 'string'; value: string; expiresAt?: number | undefined }
  | { type: 'hash'; value: Map<string, string>; expiresAt?: number | undefined }
  | { type: 'zset'; value: Map<string, number>; expiresAt?: number | undefined }

export type Field = string | number

export const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value'
export const NOT_INTEGER = 'ERR value is not an integer or out of range'
/** Redis `maxmemory` + `noeviction`의 자리 — 새 키를 만들 수 없을 때의 오류 문구도 같다. */
export const OOM_MESSAGE = "OOM command not allowed when used memory > 'maxmemory'."

/**
 * 키 수 상한 기본값. 게스트 세션 하나가 키 2개(약 0.5KB)라 10만 개면 힙 수십 MB다 — 번들의 힙
 * 상한 128MB 안에서 다른 것들과 함께 산다. 넘으면 새 키를 거절한다(기존 키 갱신은 된다).
 * 인증 없는 게스트 생성을 반복하는 클라이언트가 프로세스를 OOM으로 죽이지 못하게 하는 장치다.
 */
export const DEFAULT_MAX_KEYS = 100_000

/** Redis처럼 정수만 받는다. `''`·`'1.5'`·`'abc'`를 0이나 NaN으로 삼키지 않는다. */
export const integer = (value: Field): number => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(NOT_INTEGER)
    return value
  }
  if (!/^-?\d+$/.test(value)) throw new Error(NOT_INTEGER)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(NOT_INTEGER)
  return parsed
}

export const globToRegExp = (pattern: string): RegExp => {
  let source = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string
    if (char === '*') source += '.*'
    else if (char === '?') source += '.'
    else if (char === '\\' && i + 1 < pattern.length) {
      i += 1
      source += (pattern[i] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (char === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) source += '\\['
      else {
        source += `[${pattern.slice(i + 1, end)}]`
        i = end
      }
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 's')
}

export const parseScoreBound = (value: Field): number => {
  if (value === '-inf') return Number.NEGATIVE_INFINITY
  if (value === '+inf' || value === 'inf') return Number.POSITIVE_INFINITY
  return Number(value)
}

/**
 * 스냅샷 한 줄. 만료는 **절대 시각**(epoch ms)으로 적는다 — 내려가 있던 시간도 TTL에서 빠져야
 * 한다(Redis RDB와 같다).
 */
export type SnapshotEntry =
  | { readonly k: string; readonly t: 's'; readonly v: string; readonly e?: number }
  | {
      readonly k: string
      readonly t: 'h'
      readonly v: readonly [string, string][]
      readonly e?: number
    }
  | {
      readonly k: string
      readonly t: 'z'
      readonly v: readonly [string, number][]
      readonly e?: number
    }

const isPair = <V>(value: unknown, isValue: (item: unknown) => item is V): value is [string, V] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && isValue(value[1])
const isString = (value: unknown): value is string => typeof value === 'string'
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** 스냅샷 한 줄의 모양을 검사한다. 하나라도 틀리면 스냅샷 전체를 믿지 않는다. */
export const parseEntry = (raw: unknown): SnapshotEntry => {
  if (typeof raw !== 'object' || raw === null) throw new Error('스냅샷 항목이 객체가 아니다')
  const { k, t, v, e } = raw as Record<string, unknown>
  if (typeof k !== 'string') throw new Error('스냅샷 키가 문자열이 아니다')
  if (e !== undefined && !isFiniteNumber(e)) throw new Error(`스냅샷 만료가 숫자가 아니다: ${k}`)
  const expiry = e === undefined ? {} : { e }
  if (t === 's' && isString(v)) return { k, t, v, ...expiry }
  if (t === 'h' && Array.isArray(v) && v.every((pair) => isPair(pair, isString))) {
    return { k, t, v: v as [string, string][], ...expiry }
  }
  if (t === 'z' && Array.isArray(v) && v.every((pair) => isPair(pair, isFiniteNumber))) {
    return { k, t, v: v as [string, number][], ...expiry }
  }
  throw new Error(`스냅샷 항목의 모양이 틀렸다: ${k}`)
}
