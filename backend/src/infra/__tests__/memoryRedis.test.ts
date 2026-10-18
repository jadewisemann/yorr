import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'
import { createMemoryRedis, type MemoryRedis } from '../memoryRedis.js'

// ioredis-mock 인스턴스는 같은 프로세스 안에서 키 공간을 공유한다 — 테스트마다 키 이름을 다르게 쓴다.
let memory: MemoryRedis | undefined

afterEach(() => {
  memory?.stop()
  memory?.redis.disconnect()
  memory = undefined
})

it('아무도 다시 보지 않는 만료 키를 회수한다', async () => {
  memory = createMemoryRedis()
  const { redis } = memory
  await redis.set('room:a', '1', 'PX', 20)
  await redis.set('room:b', '1', 'PX', 20)
  await redis.set('keep', '1', 'PX', 60_000)
  await redis.set('forever', '1')
  await delay(50)

  expect(memory.sweep()).toBe(2)
  expect(memory.sweep()).toBe(0)
  expect(await redis.get('keep')).toBe('1')
  expect(await redis.get('forever')).toBe('1')
})

it('Lua 스크립트 안에서 건 만료도 회수 대상이다', async () => {
  memory = createMemoryRedis()
  const { redis } = memory
  await redis.eval("redis.call('SET', KEYS[1], 'v', 'PX', 20) return 1", 1, 'lua:key')
  await delay(50)

  expect(memory.sweep()).toBe(1)
})

it('PERSIST로 만료가 풀린 키는 지우지 않는다', async () => {
  memory = createMemoryRedis()
  const { redis } = memory
  await redis.set('k', '1', 'PX', 20)
  await redis.persist('k')
  await delay(50)

  expect(memory.sweep()).toBe(0)
  expect(await redis.get('k')).toBe('1')
})

/** DESIGN.md 원칙 7 — Lua 한 번은 원자적이다. 인프로세스 구현에서도 그래야 한다. */
it('Lua 스크립트 도중에 다른 명령이 끼어들지 않는다', async () => {
  memory = createMemoryRedis()
  const { redis } = memory
  redis.defineCommand('incrTwice', {
    numberOfKeys: 1,
    lua: "local a = redis.call('INCR', KEYS[1]) local b = redis.call('INCR', KEYS[1]) return b - a",
  })
  const incrTwice = (
    redis as unknown as { incrTwice(key: string): Promise<number> }
  ).incrTwice.bind(redis)

  const scripts: Promise<number>[] = []
  const plain: Promise<number>[] = []
  for (let i = 0; i < 500; i += 1) {
    scripts.push(incrTwice('atomic'))
    plain.push(redis.incr('atomic'))
  }
  const gaps = await Promise.all(scripts)
  await Promise.all(plain)

  expect(gaps.every((gap) => gap === 1)).toBe(true)
  expect(await redis.get('atomic')).toBe('1500')
})
