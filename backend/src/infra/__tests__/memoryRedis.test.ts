import { afterEach, describe, expect, it } from 'vitest'
import { type AtomicScript, MemoryRedis, RedisCore, runAtomicNumber } from '../memoryRedis.js'

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
    expect(core.persist('k')).toBe(0)
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
    expect(core.hmget('h', 'a', 'none')).toEqual(['2', null])
    expect(core.hvals('h')).toEqual(['2', 'x'])
    expect(() => core.hset('h', 'odd')).toThrow(/wrong number/)
  })

  it('정수가 아닌 값은 증가시키지 않는다', () => {
    const core = new RedisCore()
    core.set('s', 'abc')
    core.hset('h', 'f', 'abc')
    expect(() => core.incr('s')).toThrow(/integer/)
    expect(() => core.hincrby('h', 'f', 1)).toThrow(/integer/)
    expect(core.incrby('n', 5)).toBe(5)
  })

  it('정렬 집합은 점수·멤버 순이고 범위 삭제를 받는다', () => {
    const core = new RedisCore()
    core.zadd('z', 2, 'b', 1, 'c', 1, 'a')
    expect(core.zrange('z', 0, -1)).toEqual(['a', 'c', 'b'])
    expect(core.zrange('z', -2, -1)).toEqual(['c', 'b'])
    expect(core.zscore('z', 'b')).toBe('2')
    expect(core.zremrangebyscore('z', '-inf', 1)).toBe(2)
    expect(core.zcard('z')).toBe(1)
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

/** DESIGN.md 원칙 7 — 스크립트 한 번은 원자적이다. */
describe('원자적 스크립트', () => {
  const INCR_TWICE: AtomicScript = {
    name: 'incrTwice',
    run(r, [key]) {
      const first = r.incr(key)
      return r.incr(key) - first
    },
  }

  it('스크립트 도중에 다른 명령이 끼어들지 않는다', async () => {
    redis = new MemoryRedis()
    const client = redis
    const scripts = Array.from({ length: 500 }, () => runAtomicNumber(client, INCR_TWICE, ['k']))
    const plain = Array.from({ length: 500 }, () => client.incr('k'))

    expect((await Promise.all(scripts)).every((gap) => gap === 1)).toBe(true)
    await Promise.all(plain)
    expect(await client.get('k')).toBe('1500')
  })

  it('숫자가 아닌 반환은 계약 위반으로 던진다', async () => {
    redis = new MemoryRedis()
    const broken = { name: 'broken', run: () => 'x' } as unknown as AtomicScript
    await expect(runAtomicNumber(redis, broken, [])).rejects.toThrow(/숫자가 아니다/)
  })

  it('자리가 8칸을 넘으면 던진다', async () => {
    redis = new MemoryRedis()
    await expect(redis.runAtomic(INCR_TWICE, Array(9).fill('k'))).rejects.toThrow(/8칸/)
  })
})
