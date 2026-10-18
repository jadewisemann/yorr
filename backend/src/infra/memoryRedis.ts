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
 * 영속화는 없다 — 재시작하면 방·세션·진행 중 게임이 사라진다. 회원·전적은 SQLite에 있다.
 */

type Entry =
  | { type: 'string'; value: string; expiresAt?: number | undefined }
  | { type: 'hash'; value: Map<string, string>; expiresAt?: number | undefined }
  | { type: 'zset'; value: Map<string, number>; expiresAt?: number | undefined }

type Field = string | number

const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value'

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

/** 동기 명령 집합. 원자적 스크립트(`AtomicScript.run`)가 이것을 받는다. */
export class RedisCore {
  private readonly data = new Map<string, Entry>()

  constructor(private readonly now: () => number = Date.now) {}

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
    this.data.set(key, { type: 'hash', value })
    return value
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
    const ms = Number(milliseconds)
    if (ms <= 0) {
      this.data.delete(key)
      return 1
    }
    entry.expiresAt = this.now() + ms
    return 1
  }

  expire(key: string, seconds: Field): number {
    return this.pexpire(key, Number(seconds) * 1000)
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
    let expiresAt: number | undefined
    let onlyIfMissing = false
    let onlyIfPresent = false
    for (let i = 0; i < options.length; i += 1) {
      const option = String(options[i]).toUpperCase()
      if (option === 'EX') expiresAt = this.now() + Number(options[++i]) * 1000
      else if (option === 'PX') expiresAt = this.now() + Number(options[++i])
      else if (option === 'NX') onlyIfMissing = true
      else if (option === 'XX') onlyIfPresent = true
      else throw new Error(`지원하지 않는 SET 옵션: ${option}`)
    }
    const exists = this.live(key) !== undefined
    if ((onlyIfMissing && exists) || (onlyIfPresent && !exists)) return null
    this.data.set(key, { type: 'string', value: String(value), expiresAt })
    return 'OK'
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
    const hash = this.hashForWrite(key)
    const current = Number(hash.get(String(field)) ?? '0')
    if (!Number.isInteger(current)) throw new Error('ERR hash value is not an integer')
    const next = current + Number(increment)
    hash.set(String(field), String(next))
    return next
  }

  // ── 정렬 집합 ─────────────────────────────────────────────────────────────

  zadd(key: string, ...args: Field[]): number {
    let zset = this.zset(key)
    if (zset === undefined) {
      zset = new Map()
      this.data.set(key, { type: 'zset', value: zset })
    }
    let added = 0
    for (let i = 0; i < args.length; i += 2) {
      const member = String(args[i + 1])
      if (!zset.has(member)) added += 1
      zset.set(member, Number(args[i]))
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

  zrange(key: string, start: Field, stop: Field): string[] {
    const members = this.sorted(key)
    const length = members.length
    let from = Number(start)
    let to = Number(stop)
    if (from < 0) from = Math.max(length + from, 0)
    if (to < 0) to = length + to
    return members.slice(from, Math.min(to, length - 1) + 1)
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

const toSlots = (values: readonly (string | number)[]): Slots => {
  if (values.length > SLOT_COUNT) throw new Error(`스크립트 자리는 ${SLOT_COUNT}칸까지다`)
  const slots = values.map(String)
  while (slots.length < SLOT_COUNT) slots.push('')
  return slots as unknown as Slots
}

export interface AtomicScript<R = number> {
  readonly name: string
  /** 키·인자는 구조 분해로 이름 붙여 받는다 — Lua의 `KEYS[1]`보다 어긋나기 어렵다. */
  run(redis: RedisCore, keys: Slots, args: Slots): R
}

/**
 * ioredis 모양의 비동기 겉면. 저장소·테스트가 쓰는 메서드만 있다.
 * 장애 주입(`test/faults/faultyRedis.ts`)이 Proxy로 감쌀 수 있게 메서드는 전부 이 객체에 있다.
 */
export class MemoryRedis {
  readonly core: RedisCore
  private readonly timer: ReturnType<typeof setInterval>

  constructor(options: { now?: () => number; sweepIntervalMs?: number } = {}) {
    this.core = new RedisCore(options.now)
    this.timer = setInterval(() => this.core.sweep(), options.sweepIntervalMs ?? 60_000)
    this.timer.unref()
  }

  /** 원자적 스크립트 한 번. 명령 하나로 센다(장애 주입이 여기를 끊을 수 있다). */
  async runAtomic<R>(
    script: AtomicScript<R>,
    keys: readonly string[],
    args: readonly (string | number)[] = [],
  ): Promise<R> {
    return script.run(this.core, toSlots(keys), toSlots(args))
  }

  async exists(...keys: string[]) {
    return this.core.exists(...keys)
  }
  async del(...keys: string[]) {
    return this.core.del(...keys)
  }
  async expire(key: string, seconds: Field) {
    return this.core.expire(key, seconds)
  }
  async pexpire(key: string, milliseconds: Field) {
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
    return this.core.flushall()
  }
  async get(key: string) {
    return this.core.get(key)
  }
  async set(key: string, value: Field, ...options: Field[]) {
    return this.core.set(key, value, ...options)
  }
  async getdel(key: string) {
    return this.core.getdel(key)
  }
  async hset(key: string, ...args: (Field | Record<string, Field>)[]) {
    return this.core.hset(key, ...args)
  }
  async hget(key: string, field: Field) {
    return this.core.hget(key, field)
  }
  async hgetall(key: string) {
    return this.core.hgetall(key)
  }
  async hdel(key: string, ...fields: Field[]) {
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
    return this.core.hincrby(key, field, increment)
  }
  async zadd(key: string, ...args: Field[]) {
    return this.core.zadd(key, ...args)
  }
  async zrange(key: string, start: Field, stop: Field) {
    return this.core.zrange(key, start, stop)
  }
  async zrem(key: string, ...members: Field[]) {
    return this.core.zrem(key, ...members)
  }
  async zremrangebyscore(key: string, min: Field, max: Field) {
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
