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
 *
 * 구현은 다섯으로 나뉜다.
 * - [`redisTypes.ts`](./redisTypes.ts) — 값 모델·상수·스냅샷 파서
 * - [`redisKeyspace.ts`](./redisKeyspace.ts) — 상태와 만료·상한·스크립트 선언 규칙
 * - [`redisStrings.ts`](./redisStrings.ts) · [`redisHashes.ts`](./redisHashes.ts) ·
 *   [`redisZsets.ts`](./redisZsets.ts) · [`redisKeyCommands.ts`](./redisKeyCommands.ts) — 타입별 명령
 * - [`redisSnapshot.ts`](./redisSnapshot.ts) — 스냅샷 저장·복원과 만료 회수
 * - [`redisCore.ts`](./redisCore.ts) — 동기 명령 표면(`RedisCore`)
 * - 이 파일 — 원자적 스크립트 계약과 ioredis 모양의 비동기 겉면(`MemoryRedis`)
 */
import { RedisCore } from './redisCore.js'
import type { Field } from './redisTypes.js'

export { RedisCore } from './redisCore.js'
export {
  DEFAULT_MAX_KEYS,
  OOM_MESSAGE,
  type SnapshotEntry,
} from './redisTypes.js'

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

/**
 * 원자적 스크립트 — Lua 스크립트의 자리. `run`은 **동기** 함수여야 한다(`await` 금지):
 * 그래야 실행 도중에 다른 명령이 끼어들지 않는다. 반환 코드가 곧 계약이다.
 */
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
