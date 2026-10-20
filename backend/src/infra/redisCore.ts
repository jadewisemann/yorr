/**
 * 동기 명령 집합. 원자적 스크립트(`AtomicScript.run`)가 이것을 받는다.
 *
 * 여기 있는 메서드는 전부 **동기**다 — `runAtomic`이 `await` 없이 돌아야 그 사이에 다른 명령이
 * 끼어들지 않는다(DESIGN.md 원칙 7). 비동기 겉면은 [`memoryRedis.ts`](./memoryRedis.ts)의
 * `MemoryRedis`가 씌운다.
 */
import {
  DEFAULT_MAX_KEYS,
  type Entry,
  type Field,
  globToRegExp,
  integer,
  OOM_MESSAGE,
  parseEntry,
  parseScoreBound,
  type SnapshotEntry,
  WRONGTYPE,
} from './redisTypes.js'

export class RedisCore {
  private readonly data = new Map<string, Entry>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
  ) {}

  // ── 내부 ──────────────────────────────────────────────────────────────────

  private live(key: string): Entry | undefined {
    const entry = this.data.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.data.delete(key)
      return undefined
    }
    return entry
  }

  private hash(key: string): Map<string, string> | undefined {
    const entry = this.live(key)
    if (entry === undefined) return undefined
    if (entry.type !== 'hash') throw new Error(WRONGTYPE)
    return entry.value
  }

  private hashForWrite(key: string): Map<string, string> {
    const existing = this.hash(key)
    if (existing !== undefined) return existing
    const value = new Map<string, string>()
    this.create(key, { type: 'hash', value })
    return value
  }

  /**
   * **새** 키를 만든다. 상한에 닿으면 만료 키를 먼저 회수하고, 그래도 넘으면 거절한다
   * (`noeviction`). 이미 있는 키를 덮어쓰는 것은 키 수를 늘리지 않으므로 막지 않는다.
   */
  private create(key: string, entry: Entry): void {
    if (this.scriptCreates !== null && !this.data.has(key)) {
      if (!this.scriptCreates.keys.has(key)) {
        throw new Error(
          `${this.scriptCreates.script}: 만든다고 선언하지 않은 키를 만들었다 — ${key}`,
        )
      }
      this.data.set(key, entry)
      return
    }
    if (!this.data.has(key) && this.data.size >= this.maxKeys) {
      this.sweep()
      if (this.data.size >= this.maxKeys) throw new Error(OOM_MESSAGE)
    }
    this.data.set(key, entry)
  }

  /**
   * 원자적 스크립트를 도는 동안 그 스크립트가 만들어도 되는 키들. 상한은 실행 **전에** 이미
   * 판정했으므로(`runAdmitted`) 이 키들은 상한 없이 만든다. 이 밖의 키를 만들면 선언이 틀린 것이다.
   */
  private scriptCreates: { readonly script: string; readonly keys: ReadonlySet<string> } | null =
    null

  /**
   * 스크립트를 들이기 전에 상한을 판정한다. 스크립트가 **새로 만들 수 있다고 선언한 키** 중 아직 없는
   * 것만큼 자리가 있어야 하고, 없으면 아무것도 쓰기 전에 던진다 — 쓰다가 중간에 OOM으로 멈추면 앞의
   * 쓰기만 남는다(점수 행 없는 참가자, 제출 이력 없는 점수). 새 키를 만들지 않는 스크립트(LEAVE 등)는
   * 상한에서도 돈다 — 나가서 자리를 비울 수 있어야 한다. 들인 스크립트는 끝까지 돈다(Redis도 쓰기를
   * 시작한 스크립트는 끝낸다).
   */
  runAdmitted<R>(script: string, creatable: readonly string[], run: () => R): R {
    const missing = new Set(creatable.filter((key) => this.live(key) === undefined)).size
    if (missing > 0 && this.data.size + missing > this.maxKeys) {
      this.sweep()
      if (this.data.size + missing > this.maxKeys) throw new Error(OOM_MESSAGE)
    }
    this.scriptCreates = { script, keys: new Set(creatable) }
    try {
      return run()
    } finally {
      this.scriptCreates = null
    }
  }

  private zset(key: string): Map<string, number> | undefined {
    const entry = this.live(key)
    if (entry === undefined) return undefined
    if (entry.type !== 'zset') throw new Error(WRONGTYPE)
    return entry.value
  }

  private string(key: string): string | null {
    const entry = this.live(key)
    if (entry === undefined) return null
    if (entry.type !== 'string') throw new Error(WRONGTYPE)
    return entry.value
  }

  /** 비어 버린 해시·정렬 집합은 키째 지운다 — Redis와 같다. */
  private dropIfEmpty(key: string, container: Map<string, unknown>): void {
    if (container.size === 0) this.data.delete(key)
  }

  /** 살아 있는 키 전부를 스냅샷 줄로. 만료된 키는 싣지 않는다. */
  snapshot(): SnapshotEntry[] {
    const now = this.now()
    const entries: SnapshotEntry[] = []
    for (const [k, entry] of this.data) {
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
  restore(raw: readonly unknown[]): number {
    if (this.data.size > 0) throw new Error('스냅샷은 빈 저장소에만 들인다')
    const now = this.now()
    const live = raw
      .map(parseEntry)
      // 그 사이 만료된 키와, 빈 해시·정렬 집합(Redis에는 없는 상태)은 버린다. 빈 문자열은 값이다.
      .filter((entry) => entry.e === undefined || entry.e > now)
      .filter((entry) => entry.t === 's' || entry.v.length > 0)
    // 쓰기 전에 상한을 본다 — 중간에 OOM으로 멈춰 반쯤 들인 저장소가 남지 않게.
    if (live.length > this.maxKeys) throw new Error(OOM_MESSAGE)
    let restored = 0
    for (const entry of live) {
      const expiresAt = entry.e
      if (entry.t === 's') this.create(entry.k, { type: 'string', value: entry.v, expiresAt })
      else if (entry.t === 'h')
        this.create(entry.k, { type: 'hash', value: new Map(entry.v), expiresAt })
      else this.create(entry.k, { type: 'zset', value: new Map(entry.v), expiresAt })
      restored += 1
    }
    return restored
  }

  /** 만료된 키를 지금 지운다. 회수한 수를 돌려준다. */
  sweep(): number {
    const now = this.now()
    let reclaimed = 0
    for (const [key, entry] of this.data) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.data.delete(key)
        reclaimed += 1
      }
    }
    return reclaimed
  }

  // ── 키 ────────────────────────────────────────────────────────────────────

  exists(...keys: string[]): number {
    return keys.filter((key) => this.live(key) !== undefined).length
  }

  del(...keys: string[]): number {
    let removed = 0
    for (const key of keys) {
      if (this.live(key) !== undefined) {
        this.data.delete(key)
        removed += 1
      }
    }
    return removed
  }

  pexpire(key: string, milliseconds: Field): number {
    const entry = this.live(key)
    if (entry === undefined) return 0
    const ms = integer(milliseconds)
    if (ms <= 0) {
      this.data.delete(key)
      return 1
    }
    entry.expiresAt = this.now() + ms
    return 1
  }

  expire(key: string, seconds: Field): number {
    return this.pexpire(key, integer(seconds) * 1000)
  }

  pttl(key: string): number {
    const entry = this.live(key)
    if (entry === undefined) return -2
    if (entry.expiresAt === undefined) return -1
    return entry.expiresAt - this.now()
  }

  ttl(key: string): number {
    const ms = this.pttl(key)
    return ms < 0 ? ms : Math.round(ms / 1000)
  }

  keys(pattern = '*'): string[] {
    const matcher = globToRegExp(pattern)
    return [...this.data.keys()].filter((key) => this.live(key) !== undefined && matcher.test(key))
  }

  flushall(): 'OK' {
    this.data.clear()
    return 'OK'
  }

  // ── 문자열 ────────────────────────────────────────────────────────────────

  get(key: string): string | null {
    return this.string(key)
  }

  /** `SET key value [EX s | PX ms] [NX | XX]` → 'OK' · 조건 불충족이면 null. TTL은 새로 정한다. */
  set(key: string, value: Field, ...options: Field[]): 'OK' | null {
    const { expiresAt, condition } = this.parseSetOptions(options)
    const exists = this.live(key) !== undefined
    if ((condition === 'NX' && exists) || (condition === 'XX' && !exists)) return null
    const entry: Entry = { type: 'string', value: String(value), expiresAt }
    if (exists) this.data.set(key, entry)
    else this.create(key, entry)
    return 'OK'
  }

  private parseSetOptions(options: readonly Field[]): {
    expiresAt: number | undefined
    condition: 'NX' | 'XX' | null
  } {
    let expiresAt: number | undefined
    let condition: 'NX' | 'XX' | null = null
    for (let i = 0; i < options.length; i += 1) {
      const option = String(options[i]).toUpperCase()
      if (option === 'EX' || option === 'PX') {
        const amount = integer(options[i + 1] ?? '')
        i += 1
        expiresAt = this.now() + (option === 'EX' ? amount * 1000 : amount)
      } else if (option === 'NX' || option === 'XX') {
        condition = option
      } else {
        throw new Error(`지원하지 않는 SET 옵션: ${option}`)
      }
    }
    return { expiresAt, condition }
  }

  getdel(key: string): string | null {
    const value = this.string(key)
    if (value !== null) this.data.delete(key)
    return value
  }

  // ── 해시 ──────────────────────────────────────────────────────────────────

  /** `HSET key field value [field value ...]` 또는 `HSET key { field: value }` → 새로 생긴 필드 수. */
  hset(key: string, ...args: (Field | Record<string, Field>)[]): number {
    const pairs: [string, string][] = []
    const [first] = args
    if (args.length === 1 && typeof first === 'object' && first !== null) {
      for (const [field, value] of Object.entries(first)) pairs.push([field, String(value)])
    } else {
      if (args.length === 0 || args.length % 2 !== 0) {
        throw new Error("ERR wrong number of arguments for 'hset' command")
      }
      for (let i = 0; i < args.length; i += 2) pairs.push([String(args[i]), String(args[i + 1])])
    }
    const hash = this.hashForWrite(key)
    let added = 0
    for (const [field, value] of pairs) {
      if (!hash.has(field)) added += 1
      hash.set(field, value)
    }
    return added
  }

  hget(key: string, field: Field): string | null {
    return this.hash(key)?.get(String(field)) ?? null
  }

  hgetall(key: string): Record<string, string> {
    return Object.fromEntries(this.hash(key) ?? [])
  }

  hdel(key: string, ...fields: Field[]): number {
    const hash = this.hash(key)
    if (hash === undefined) return 0
    let removed = 0
    for (const field of fields) if (hash.delete(String(field))) removed += 1
    this.dropIfEmpty(key, hash)
    return removed
  }

  hexists(key: string, field: Field): number {
    return this.hash(key)?.has(String(field)) ? 1 : 0
  }

  hlen(key: string): number {
    return this.hash(key)?.size ?? 0
  }

  hkeys(key: string): string[] {
    return [...(this.hash(key)?.keys() ?? [])]
  }

  hincrby(key: string, field: Field, increment: Field): number {
    // 인자부터 본다 — 틀린 인자로 빈 해시가 생기면 안 된다.
    const step = integer(increment)
    const hash = this.hashForWrite(key)
    const current = Number(hash.get(String(field)) ?? '0')
    if (!Number.isInteger(current)) throw new Error('ERR hash value is not an integer')
    const next = current + step
    hash.set(String(field), String(next))
    return next
  }

  // ── 정렬 집합 ─────────────────────────────────────────────────────────────

  zadd(key: string, ...args: Field[]): number {
    if (args.length === 0 || args.length % 2 !== 0) {
      throw new Error("ERR wrong number of arguments for 'zadd' command")
    }
    const pairs: [number, string][] = []
    for (let i = 0; i < args.length; i += 2) {
      const score = Number(args[i])
      if (Number.isNaN(score)) throw new Error('ERR value is not a valid float')
      pairs.push([score, String(args[i + 1])])
    }
    let zset = this.zset(key)
    if (zset === undefined) {
      zset = new Map()
      this.create(key, { type: 'zset', value: zset })
    }
    let added = 0
    for (const [score, member] of pairs) {
      if (!zset.has(member)) added += 1
      zset.set(member, score)
    }
    return added
  }

  private sorted(key: string): string[] {
    const zset = this.zset(key)
    if (zset === undefined) return []
    return [...zset.entries()]
      .sort(([a, scoreA], [b, scoreB]) => scoreA - scoreB || (a < b ? -1 : a > b ? 1 : 0))
      .map(([member]) => member)
  }

  /** Redis `ZRANGE`의 색인 규칙 그대로: 음수는 끝에서, 범위를 벗어나면 잘라내고, 비면 []. */
  zrange(key: string, start: Field, stop: Field): string[] {
    const members = this.sorted(key)
    const length = members.length
    let from = integer(start)
    let to = integer(stop)
    if (from < 0) from += length
    if (to < 0) to += length
    if (from < 0) from = 0
    if (to >= length) to = length - 1
    if (from > to || from >= length) return []
    return members.slice(from, to + 1)
  }

  zrem(key: string, ...members: Field[]): number {
    const zset = this.zset(key)
    if (zset === undefined) return 0
    let removed = 0
    for (const member of members) if (zset.delete(String(member))) removed += 1
    this.dropIfEmpty(key, zset)
    return removed
  }

  zremrangebyscore(key: string, min: Field, max: Field): number {
    const zset = this.zset(key)
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
    this.dropIfEmpty(key, zset)
    return removed
  }
}
