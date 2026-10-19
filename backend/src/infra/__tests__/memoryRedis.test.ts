import { afterEach, describe, expect, it } from 'vitest'
import {
  type AtomicScript,
  DEFAULT_MAX_KEYS,
  MemoryRedis,
  OOM_MESSAGE,
  RedisCore,
  runAtomicNumber,
  UNLOCK_IF_OWNER,
} from '../memoryRedis.js'

/**
 * 인프로세스 저장소 자체의 계약. 저장소들의 통합 스위트(useRedis)가 쓰임새를 덮고, 여기서는
 * 그 스위트가 우연히 밟지 않는 Redis 시맨틱과 원자성만 고정한다.
 */
const clock = () => {
  let now = 1_000_000
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

let redis: MemoryRedis | undefined
afterEach(() => {
  redis?.disconnect()
  redis = undefined
})

describe('만료', () => {
  it('만료된 키는 보이지 않고, 아무도 다시 보지 않아도 회수된다', () => {
    const time = clock()
    const core = new RedisCore(time.now)
    core.set('room:a', '1', 'PX', 20)
    core.hset('room:b', 'f', 'v')
    core.pexpire('room:b', 20)
    core.set('forever', '1')
    time.advance(21)

    expect(core.sweep()).toBe(2)
    expect(core.keys()).toEqual(['forever'])
    expect(core.exists('room:a')).toBe(0)
  })

  it('SET은 TTL을 지우고, 해시 쓰기는 TTL을 남긴다', () => {
    const core = new RedisCore()
    core.set('s', '1', 'EX', 60)
    core.set('s', '2')
    expect(core.pttl('s')).toBe(-1)

    core.hset('h', 'a', '1')
    core.expire('h', 60)
    core.hset('h', 'b', '2')
    expect(core.pttl('h')).toBeGreaterThan(0)
  })

  it('PTTL은 없는 키에 -2, 만료 없는 키에 -1이다', () => {
    const core = new RedisCore()
    core.set('k', '1')
    expect(core.pttl('none')).toBe(-2)
    expect(core.pttl('k')).toBe(-1)
  })

  it('0 이하로 만료를 걸면 즉시 지운다', () => {
    const core = new RedisCore()
    core.set('k', '1')
    expect(core.expire('k', 0)).toBe(1)
    expect(core.exists('k')).toBe(0)
  })
})

describe('자료형', () => {
  it('마지막 필드를 지운 해시는 키째 사라진다', () => {
    const core = new RedisCore()
    core.hset('h', 'a', '1')
    expect(core.hdel('h', 'a')).toBe(1)
    expect(core.exists('h')).toBe(0)
  })

  it('타입이 다른 키에는 WRONGTYPE으로 던진다', () => {
    const core = new RedisCore()
    core.set('s', '1')
    expect(() => core.hget('s', 'f')).toThrow(/WRONGTYPE/)
    core.hset('h', 'f', 'v')
    expect(() => core.get('h')).toThrow(/WRONGTYPE/)
    expect(() => core.zrange('h', 0, -1)).toThrow(/WRONGTYPE/)
  })

  it('SET NX·XX는 조건이 맞을 때만 쓴다', () => {
    const core = new RedisCore()
    expect(core.set('k', 'a', 'XX')).toBeNull()
    expect(core.set('k', 'a', 'NX')).toBe('OK')
    expect(core.set('k', 'b', 'NX')).toBeNull()
    expect(core.get('k')).toBe('a')
    expect(() => core.set('k', 'c', 'KEEPTTL')).toThrow(/지원하지 않는/)
  })

  it('HSET은 객체도 받고, 숫자는 문자열로 적는다', () => {
    const core = new RedisCore()
    expect(core.hset('h', { a: 1, b: 'x' })).toBe(2)
    expect(core.hset('h', 'a', 2)).toBe(0)
    expect(core.hgetall('h')).toEqual({ a: '2', b: 'x' })
    expect(() => core.hset('h', 'odd')).toThrow(/wrong number/)
  })

  it('정수가 아닌 값은 증가시키지 않는다', () => {
    const core = new RedisCore()
    core.hset('h', 'f', 'abc')
    expect(() => core.hincrby('h', 'f', 1)).toThrow(/integer/)
    expect(core.hincrby('h', 'n', 5)).toBe(5)
  })

  it('정렬 집합은 점수·멤버 순이고 범위 삭제를 받는다', () => {
    const core = new RedisCore()
    core.zadd('z', 2, 'b', 1, 'c', 1, 'a')
    expect(core.zrange('z', 0, -1)).toEqual(['a', 'c', 'b'])
    expect(core.zrange('z', -2, -1)).toEqual(['c', 'b'])
    expect(core.zremrangebyscore('z', '-inf', 1)).toBe(2)
    expect(core.zrange('z', 0, -1)).toEqual(['b'])
    expect(core.zrem('z', 'b')).toBe(1)
    expect(core.exists('z')).toBe(0)
  })

  it('KEYS·SCAN은 glob 패턴을 받는다', async () => {
    redis = new MemoryRedis()
    await redis.set('room:AB12', '1')
    await redis.set('room:AB12:players', '1')
    await redis.set('user:1', '1')
    expect((await redis.keys('room:????')).sort()).toEqual(['room:AB12'])
    expect((await redis.scan('0', 'MATCH', 'room:*', 'COUNT', 100))[1].sort()).toEqual([
      'room:AB12',
      'room:AB12:players',
    ])
    expect(await redis.keys('user:[0-9]')).toEqual(['user:1'])
  })
})

describe('정수 인자', () => {
  it('TTL·증가값·범위는 정수만 받는다 — 빈 문자열을 0으로 삼켜 키를 지우지 않는다', () => {
    const core = new RedisCore()
    core.set('k', '1')
    core.hset('h', 'f', '1')
    for (const bad of ['', ' ', '1.5', 'abc', '1e3', Number.NaN, 1.5]) {
      expect(() => core.expire('k', bad), `expire ${String(bad)}`).toThrow(/not an integer/)
      expect(() => core.pexpire('k', bad), `pexpire ${String(bad)}`).toThrow(/not an integer/)
      expect(() => core.set('s', 'v', 'EX', bad), `set EX ${String(bad)}`).toThrow(/not an integer/)
      expect(() => core.hincrby('h', 'f', bad), `hincrby ${String(bad)}`).toThrow(/not an integer/)
      expect(() => core.zrange('z', bad, -1), `zrange ${String(bad)}`).toThrow(/not an integer/)
    }
    expect(core.get('k')).toBe('1')
    expect(core.pttl('k')).toBe(-1)
    expect(core.hget('h', 'f')).toBe('1')
    expect(core.exists('s')).toBe(0)
    expect(() => core.set('s', 'v', 'EX')).toThrow(/not an integer/)
    expect(core.expire('k', '60')).toBe(1)
    expect(core.hincrby('h', 'f', '-3')).toBe(-2)
  })

  it('틀린 증가값으로 빈 해시를 만들지 않는다', () => {
    const core = new RedisCore()
    expect(() => core.hincrby('new', 'f', 'x')).toThrow()
    expect(core.exists('new')).toBe(0)
  })

  it('ZADD는 짝이 안 맞거나 점수가 숫자가 아니면 아무것도 쓰지 않는다', () => {
    const core = new RedisCore()
    expect(() => core.zadd('z', 1)).toThrow(/wrong number/)
    expect(() => core.zadd('z', 'nope', 'a')).toThrow(/valid float/)
    expect(core.exists('z')).toBe(0)
  })
})

describe('ZRANGE 색인 (Redis 규칙 전수)', () => {
  /** Redis `zrangeGenericCommand`의 규칙을 그대로 옮긴 기준 구현. */
  const reference = (length: number, start: number, stop: number): number[] => {
    let from = start < 0 ? start + length : start
    let to = stop < 0 ? stop + length : stop
    if (from < 0) from = 0
    if (from > to || from >= length) return []
    if (to >= length) to = length - 1
    return Array.from({ length: to - from + 1 }, (_, index) => from + index)
  }

  it('길이 0~4 × start·stop ∈ [-6, 6] 전부에서 기준 구현과 같다', () => {
    for (let length = 0; length <= 4; length += 1) {
      const core = new RedisCore()
      const members = Array.from({ length }, (_, index) => `m${index}`)
      for (const [index, member] of members.entries()) core.zadd('z', index, member)
      for (let start = -6; start <= 6; start += 1) {
        for (let stop = -6; stop <= 6; stop += 1) {
          const expected = reference(length, start, stop).map((index) => `m${index}`)
          expect(core.zrange('z', start, stop), `len=${length} ${start}..${stop}`).toEqual(expected)
        }
      }
    }
  })
})

describe('키 수 상한 (maxmemory noeviction)', () => {
  it('상한에 닿으면 새 키를 거절하고, 기존 키 갱신·삭제는 계속된다', () => {
    const core = new RedisCore(Date.now, 3)
    core.set('a', '1')
    core.hset('b', 'f', '1')
    core.zadd('c', 1, 'm')
    expect(() => core.set('d', '1')).toThrow(OOM_MESSAGE)
    expect(() => core.hset('d', 'f', '1')).toThrow(OOM_MESSAGE)
    expect(() => core.zadd('d', 1, 'm')).toThrow(OOM_MESSAGE)
    expect(() => core.hincrby('d', 'f', 1)).toThrow(OOM_MESSAGE)
    expect(core.exists('d')).toBe(0)

    expect(core.set('a', '2')).toBe('OK')
    expect(core.hset('b', 'g', '2')).toBe(1)
    expect(core.zadd('c', 2, 'n')).toBe(1)
    core.del('a')
    expect(core.set('d', '1')).toBe('OK')
  })

  it('만료된 키는 상한 판정 전에 회수된다', () => {
    let now = 0
    const core = new RedisCore(() => now, 2)
    core.set('a', '1', 'PX', 10)
    core.set('b', '1', 'PX', 10)
    now = 11
    expect(core.set('c', '1')).toBe('OK')
  })

  it('원자적 스크립트 안에서 상한에 닿으면 스크립트가 던진다', async () => {
    redis = new MemoryRedis({ maxKeys: 1 })
    await redis.set('taken', '1')
    const CREATE_TWO: AtomicScript = {
      name: 'createTwo',
      keys: 1,
      args: 0,
      run(r, [key]) {
        return r.hset(key, 'f', '1')
      },
    }
    await expect(redis.runAtomic(CREATE_TWO, ['new'])).rejects.toThrow(OOM_MESSAGE)
  })

  it('기본 상한은 번들 힙(128MB) 안에 든다 — 게스트 세션 모양 10만 쌍을 채워 잰다', () => {
    const core = new RedisCore()
    // 게스트 세션 = user:{id} 해시 + token 문자열. 상한까지 채운다.
    const before = process.memoryUsage().heapUsed
    let created = 0
    try {
      for (let index = 0; ; index += 1) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
        core.hset(
          `user:${id}`,
          'nickname',
          `손님${index}`,
          'kind',
          'GUEST',
          'createdAt',
          String(index),
        )
        core.set(`user:token:${'f'.repeat(64)}${index}`, id, 'EX', 86_400)
        created += 2
      }
    } catch (error) {
      expect((error as Error).message).toBe(OOM_MESSAGE)
    }
    const usedMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024
    expect(created).toBe(DEFAULT_MAX_KEYS)
    expect(usedMb, `키 ${created}개가 쓴 힙`).toBeLessThan(80)
  })
})

/** DESIGN.md 원칙 7 — 스크립트 한 번은 원자적이다. */
describe('원자적 스크립트', () => {
  const INCR_TWICE: AtomicScript = {
    name: 'incrTwice',
    keys: 1,
    args: 0,
    run(r, [key]) {
      const first = r.hincrby(key, 'n', 1)
      return r.hincrby(key, 'n', 1) - first
    },
  }

  it('스크립트 도중에 다른 명령이 끼어들지 않는다', async () => {
    redis = new MemoryRedis()
    const client = redis
    const scripts = Array.from({ length: 500 }, () => runAtomicNumber(client, INCR_TWICE, ['k']))
    const plain = Array.from({ length: 500 }, () => client.hincrby('k', 'n', 1))

    expect((await Promise.all(scripts)).every((gap) => gap === 1)).toBe(true)
    await Promise.all(plain)
    expect(await client.hget('k', 'n')).toBe('1500')
  })

  it('잠금 해제는 토큰이 맞을 때만 지운다', async () => {
    redis = new MemoryRedis()
    await redis.set('lock', 'mine', 'PX', 5_000)
    expect(await runAtomicNumber(redis, UNLOCK_IF_OWNER, ['lock'], ['theirs'])).toBe(0)
    expect(await redis.get('lock')).toBe('mine')
    expect(await runAtomicNumber(redis, UNLOCK_IF_OWNER, ['lock'], ['mine'])).toBe(1)
    expect(await redis.exists('lock')).toBe(0)
    expect(await runAtomicNumber(redis, UNLOCK_IF_OWNER, ['lock'], ['mine'])).toBe(0)
  })

  it('숫자가 아닌 반환은 계약 위반으로 던진다', async () => {
    redis = new MemoryRedis()
    const broken = { name: 'broken', keys: 0, args: 0, run: () => 'x' } as unknown as AtomicScript
    await expect(runAtomicNumber(redis, broken, [])).rejects.toThrow(/숫자가 아니다/)
  })

  it('선언한 키·인자 개수와 다르면 실행하지 않는다 — 모자란 인자가 빈 문자열로 쓰이지 않는다', async () => {
    redis = new MemoryRedis()
    const ran: string[] = []
    const SET_TTL: AtomicScript = {
      name: 'setTtl',
      keys: 1,
      args: 1,
      run(r, [key], [ttl]) {
        ran.push(ttl)
        r.set(key, 'v')
        return r.expire(key, ttl)
      },
    }
    await expect(redis.runAtomic(SET_TTL, ['k'], [])).rejects.toThrow(/args 1개가 필요한데 0개/)
    await expect(redis.runAtomic(SET_TTL, ['k'], [60, 1])).rejects.toThrow(
      /args 1개가 필요한데 2개/,
    )
    await expect(redis.runAtomic(SET_TTL, [], [60])).rejects.toThrow(/keys 1개가 필요한데 0개/)
    expect(ran).toEqual([])
    expect(await redis.exists('k')).toBe(0)
    await expect(redis.runAtomic(SET_TTL, ['k'], [60])).resolves.toBe(1)
  })
})
