/**
 * 프로세스 안의 Redis — Botkeep 단일 프로세스 배포([ADR-0007](../../docs/adr/0007-botkeep-single-process.md)).
 *
 * Redis 서버도 ioredis도 없다. 코드가 실제로 쓰는 명령만 **동기식으로** 구현하고, 바깥에는
 * ioredis와 같은 이름의 비동기 메서드를 내놓는다 — 저장소 코드는 Redis를 쓰던 모양 그대로다.
 *
 * 원자성(DESIGN.md 원칙 7)은 Lua 대신 `runAtomic`이 진다: 스크립트는 `RedisCore`를 받는 동기
 * 함수이고, 도중에 `await`가 없으므로 Node의 단일 스레드에서 다른 명령이 끼어들 수 없다.
 *
 * 지키는 Redis 시맨틱(테스트가 기대한다):
 * - 값은 문자열이다. 숫자를 넣으면 문자열로 적고, 없으면 `null`이다.
 * - `SET`은 기존 TTL을 지운다. 해시·정렬 집합을 고치는 명령은 TTL을 건드리지 않는다.
 * - 필드를 다 지운 해시·정렬 집합은 키째 사라진다(`EXISTS`가 0이 된다).
 * - 타입이 다른 키에 명령을 보내면 `WRONGTYPE`으로 던진다.
 * - 만료는 접근할 때 확인하고, 아무도 다시 보지 않는 키는 주기적으로 회수한다.
 *
 * 재시작을 넘기는 것은 스냅샷이다(`snapshot`/`restore`, 파일 I/O는 `storeSnapshot.ts`). 회원·전적은 SQLite에 있다.
 */

type Entry =
  | { type: 'string'; value: string; expiresAt?: number | undefined }
  | { type: 'hash'; value: Map<string, string>; expiresAt?: number | undefined }
  | { type: 'zset'; value: Map<string, number>; expiresAt?: number | undefined }

type Field = string | number

const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value'
const NOT_INTEGER = 'ERR value is not an integer or out of range'
/** Redis `maxmemory` + `noeviction`의 자리 — 새 키를 만들 수 없을 때의 오류 문구도 같다. */
export const OOM_MESSAGE = "OOM command not allowed when used memory > 'maxmemory'."

/**
 * 키 수 상한 기본값. 게스트 세션 하나가 키 2개(약 0.5KB)라 10만 개면 힙 수십 MB다 — 번들의 힙
 * 상한 128MB 안에서 다른 것들과 함께 산다. 넘으면 새 키를 거절한다(기존 키 갱신은 된다).
 * 인증 없는 게스트 생성을 반복하는 클라이언트가 프로세스를 OOM으로 죽이지 못하게 하는 장치다.
 */
export const DEFAULT_MAX_KEYS = 100_000

/** Redis처럼 정수만 받는다. `''`·`'1.5'`·`'abc'`를 0이나 NaN으로 삼키지 않는다. */
const integer = (value: Field): number => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(NOT_INTEGER)
    return value
  }
  if (!/^-?\d+$/.test(value)) throw new Error(NOT_INTEGER)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(NOT_INTEGER)
  return parsed
}

const globToRegExp = (pattern: string): RegExp => {
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

const parseScoreBound = (value: Field): number => {
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
const parseEntry = (raw: unknown): SnapshotEntry => {
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

/** 동기 명령 집합. 원자적 스크립트(`AtomicScript.run`)가 이것을 받는다. */
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

/**
 * 원자적 스크립트 — Lua 스크립트의 자리. `run`은 **동기** 함수여야 한다(`await` 금지):
 * 그래야 실행 도중에 다른 명령이 끼어들지 않는다. 반환 코드가 곧 계약이다.
 */
/**
 * 스크립트가 받는 키·인자 자리. 앞의 8칸은 항상 문자열이다 — 실행기가 모자란 자리를 빈
 * 문자열로 채운다. 가장 많이 받는 스크립트(CONFIRM_SCORE)가 키 6개·인자 8개다.
 */
export type Slots = readonly [string, string, string, string, string, string, string, string]

const SLOT_COUNT = 8

/**
 * 선언한 개수와 **정확히** 같아야 한다(Lua의 `numberOfKeys`와 같은 계약). 남는 자리는 빈 문자열로
 * 채우지만, 선언보다 적게 넘기면 그 빈 문자열이 진짜 값처럼 쓰이므로(예: TTL `''`) 여기서 거절한다.
 */
const toSlots = (
  script: string,
  kind: 'keys' | 'args',
  expected: number,
  values: readonly (string | number)[],
): Slots => {
  if (values.length !== expected) {
    throw new Error(`${script}: ${kind} ${expected}개가 필요한데 ${values.length}개를 받았다`)
  }
  const slots = values.map(String)
  while (slots.length < SLOT_COUNT) slots.push('')
  return slots as unknown as Slots
}

export interface AtomicScript<R = number> {
  readonly name: string
  /** 키·인자 개수(최대 8). 호출이 이와 다르면 실행하지 않고 던진다. */
  readonly keys: number
  readonly args: number
  /**
   * 새로 만들 수 있는 키의 **자리 번호**(0부터). 상한 판정이 이것으로 실행 전에 끝난다. 여기 없는
   * 키를 만들면 실행 중에 던진다 — 선언이 곧 계약이고, 통합 스위트가 그것을 검증한다. 없으면 [].
   */
  readonly creates?: readonly number[]
  /** 키·인자는 구조 분해로 이름 붙여 받는다 — Lua의 `KEYS[1]`보다 어긋나기 어렵다. */
  run(redis: RedisCore, keys: Slots, args: Slots): R
}

/**
 * 토큰 비교 후 삭제 — "내가 잡은 잠금일 때만 푼다". 그냥 DEL하면 TTL로 이미 풀린 뒤 남이 다시 잡은
 * 잠금을 지운다. 상태 저장소들(야추·결투·다빈치·탁구)과 퀵매치가 함께 쓴다.
 */
export const UNLOCK_IF_OWNER: AtomicScript = {
  name: 'unlockIfOwner',
  keys: 1,
  args: 1,
  run(r, [lock], [token]) {
    return r.get(lock) === token ? r.del(lock) : 0
  },
}

/**
 * ioredis 모양의 비동기 겉면. 저장소·테스트가 쓰는 메서드만 있다.
 * 장애 주입(`test/faults/faultyRedis.ts`)이 Proxy로 감쌀 수 있게 메서드는 전부 이 객체에 있다.
 */
export class MemoryRedis {
  readonly core: RedisCore
  private readonly timer: ReturnType<typeof setInterval>

  constructor(options: { now?: () => number; sweepIntervalMs?: number; maxKeys?: number } = {}) {
    this.core = new RedisCore(options.now, options.maxKeys)
    this.timer = setInterval(() => this.core.sweep(), options.sweepIntervalMs ?? 60_000)
    this.timer.unref()
  }

  /**
   * 쓰기 명령(원자적 스크립트 포함)이 들어온 횟수. 스냅샷이 "지난번 이후 바뀐 게 없으면 건너뛴다"를
   * 판정하는 데 쓴다. 실제로 바뀌었는지가 아니라 **바뀔 수 있는 명령이 왔는지**를 센다 — 놓치는
   * 쪽보다 한 번 더 쓰는 쪽이 안전하다. 만료로 사라지는 키는 세지 않는다: 스냅샷의 만료가 절대
   * 시각이라 다시 들일 때 걸러진다.
   */
  changes = 0

  /** 원자적 스크립트 한 번. 명령 하나로 센다(장애 주입이 여기를 끊을 수 있다). */
  async runAtomic<R>(
    script: AtomicScript<R>,
    keys: readonly string[],
    args: readonly (string | number)[] = [],
  ): Promise<R> {
    this.changes += 1
    const keySlots = toSlots(script.name, 'keys', script.keys, keys)
    const argSlots = toSlots(script.name, 'args', script.args, args)
    const creatable = (script.creates ?? []).map((index) => keys[index] as string)
    return this.core.runAdmitted(script.name, creatable, () =>
      script.run(this.core, keySlots, argSlots),
    )
  }

  async exists(...keys: string[]) {
    return this.core.exists(...keys)
  }
  async del(...keys: string[]) {
    this.changes += 1
    return this.core.del(...keys)
  }
  async expire(key: string, seconds: Field) {
    this.changes += 1
    return this.core.expire(key, seconds)
  }
  async pexpire(key: string, milliseconds: Field) {
    this.changes += 1
    return this.core.pexpire(key, milliseconds)
  }
  async ttl(key: string) {
    return this.core.ttl(key)
  }
  async pttl(key: string) {
    return this.core.pttl(key)
  }
  async keys(pattern?: string) {
    return this.core.keys(pattern)
  }
  /** 커서를 흉내 내지 않는다 — 첫 호출에 전부 돌려주고 커서 '0'으로 끝낸다. */
  async scan(_cursor: Field, ...options: Field[]): Promise<[string, string[]]> {
    const index = options.findIndex((option) => String(option).toUpperCase() === 'MATCH')
    const pattern = index === -1 ? '*' : String(options[index + 1])
    return ['0', this.core.keys(pattern)]
  }
  async flushall() {
    this.changes += 1
    return this.core.flushall()
  }
  async get(key: string) {
    return this.core.get(key)
  }
  async set(key: string, value: Field, ...options: Field[]) {
    this.changes += 1
    return this.core.set(key, value, ...options)
  }
  async getdel(key: string) {
    this.changes += 1
    return this.core.getdel(key)
  }
  async hset(key: string, ...args: (Field | Record<string, Field>)[]) {
    this.changes += 1
    return this.core.hset(key, ...args)
  }
  async hget(key: string, field: Field) {
    return this.core.hget(key, field)
  }
  async hgetall(key: string) {
    return this.core.hgetall(key)
  }
  async hdel(key: string, ...fields: Field[]) {
    this.changes += 1
    return this.core.hdel(key, ...fields)
  }
  async hexists(key: string, field: Field) {
    return this.core.hexists(key, field)
  }
  async hlen(key: string) {
    return this.core.hlen(key)
  }
  async hkeys(key: string) {
    return this.core.hkeys(key)
  }
  async hincrby(key: string, field: Field, increment: Field) {
    this.changes += 1
    return this.core.hincrby(key, field, increment)
  }
  async zadd(key: string, ...args: Field[]) {
    this.changes += 1
    return this.core.zadd(key, ...args)
  }
  async zrange(key: string, start: Field, stop: Field) {
    return this.core.zrange(key, start, stop)
  }
  async zrem(key: string, ...members: Field[]) {
    this.changes += 1
    return this.core.zrem(key, ...members)
  }
  async zremrangebyscore(key: string, min: Field, max: Field) {
    this.changes += 1
    return this.core.zremrangebyscore(key, min, max)
  }
  async ping(): Promise<'PONG'> {
    return 'PONG'
  }
  /** 같은 저장소를 보는 또 하나의 "연결". 프로세스 안이라 같은 객체다. */
  duplicate(): MemoryRedis {
    return this
  }
  disconnect(): void {
    clearInterval(this.timer)
  }
}

/** 저장소 코드가 쓰는 타입 이름. ioredis 시절의 `Redis`와 같은 자리다. */
export type Redis = MemoryRedis

/** 반환 코드가 계약인 스크립트용 — 숫자가 아니면 계약 위반이므로 조용히 넘기지 않는다. */
export const runAtomicNumber = async (
  redis: MemoryRedis,
  script: AtomicScript<number>,
  keys: readonly string[],
  args: readonly (string | number)[] = [],
): Promise<number> => {
  const result = await redis.runAtomic(script, keys, args)
  if (typeof result !== 'number' || Number.isNaN(result)) {
    throw new Error(`${script.name}의 반환값이 숫자가 아니다: ${JSON.stringify(result)}`)
  }
  return result
}
