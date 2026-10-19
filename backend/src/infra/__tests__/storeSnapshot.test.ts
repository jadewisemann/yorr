import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPrng, iterationsFromEnv, seedFromEnv } from '../../../test/fuzz/prng.js'
import { MemoryRedis, RedisCore } from '../memoryRedis.js'
import { loadStoreSnapshot, SNAPSHOT_VERSION, saveStoreSnapshot } from '../storeSnapshot.js'

/**
 * 저장소 스냅샷 — 재시작해도 방·세션·진행 중 게임이 이어지는 근거다(`infra/storeSnapshot.ts`).
 * SQLite가 "쓰다 죽으면 이전 상태가 남는가"를 따로 시험하듯, 왕복 보존·만료·손상·원자성을 나눠 본다.
 */
const dirs: string[] = []
const stores: MemoryRedis[] = []
const tempPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'yorr-snapshot-'))
  dirs.push(dir)
  return join(dir, 'nested', 'store.json')
}
const store = (now: () => number = Date.now): MemoryRedis => {
  const created = new MemoryRedis({ now })
  stores.push(created)
  return created
}

afterEach(() => {
  for (const created of stores.splice(0)) created.disconnect()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('왕복', () => {
  it('세 자료형과 TTL을 그대로 되살린다', async () => {
    let now = 1_000_000
    const source = store(() => now)
    await source.set('s', '값', 'PX', 5_000)
    await source.set('empty', '')
    await source.hset('h', { a: '1', b: '두' })
    await source.pexpire('h', 9_000)
    await source.zadd('z', 2, 'b', 1, 'a')
    const path = tempPath()
    expect(saveStoreSnapshot(source, path, now)).toBe(4)

    // 내려가 있던 2초도 TTL에서 빠져야 한다(절대 시각으로 적었다).
    now += 2_000
    const target = store(() => now)
    expect(loadStoreSnapshot(target, path, now)).toEqual({ kind: 'restored', entries: 4 })
    expect(await target.get('s')).toBe('값')
    expect(await target.get('empty')).toBe('')
    expect(await target.pttl('s')).toBe(3_000)
    expect(await target.hgetall('h')).toEqual({ a: '1', b: '두' })
    expect(await target.pttl('h')).toBe(7_000)
    expect(await target.pttl('empty')).toBe(-1)
    expect(await target.zrange('z', 0, -1)).toEqual(['a', 'b'])
  })

  it('내려가 있는 동안 만료된 키는 들이지 않는다', async () => {
    let now = 0
    const source = store(() => now)
    await source.set('short', '1', 'PX', 100)
    await source.set('long', '1', 'PX', 10_000)
    const path = tempPath()
    saveStoreSnapshot(source, path, now)
    now = 500
    const target = store(() => now)
    expect(loadStoreSnapshot(target, path, now)).toEqual({ kind: 'restored', entries: 1 })
    expect(await target.exists('short', 'long')).toBe(1)
  })

  it('파일이 없으면 빈 저장소 그대로다', () => {
    expect(loadStoreSnapshot(store(), tempPath())).toEqual({ kind: 'missing' })
  })

  it(`무작위 저장소 왕복 (seed=${seedFromEnv('SNAPSHOT_SEED')})`, () => {
    const prng = createPrng(seedFromEnv('SNAPSHOT_SEED'))
    const iterations = iterationsFromEnv('SNAPSHOT_ITERATIONS', 30)
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const source = new RedisCore(() => 0)
      for (let key = 0; key < prng.int(0, 40); key += 1) {
        const name = `k${key}`
        const kind = prng.int(0, 2)
        if (kind === 0) source.set(name, String(prng.next()))
        else if (kind === 1) source.hset(name, `f${prng.int(0, 3)}`, String(prng.int(0, 9)))
        else source.zadd(name, prng.int(-5, 5), `m${prng.int(0, 3)}`)
        if (prng.chance(0.5)) source.pexpire(name, prng.int(1, 10_000))
      }
      const json = JSON.parse(JSON.stringify(source.snapshot())) as unknown[]
      const target = new RedisCore(() => 0)
      target.restore(json)
      expect(target.snapshot(), `iteration=${iteration}`).toEqual(source.snapshot())
    }
  })
})

describe('손상', () => {
  const corruptions: [string, string][] = [
    ['JSON이 아니다', '{not json'],
    ['버전이 다르다', JSON.stringify({ version: 99, savedAt: 0, entries: [] })],
    ['entries가 없다', JSON.stringify({ version: SNAPSHOT_VERSION, savedAt: 0 })],
    [
      '항목 모양이 틀렸다',
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        savedAt: 0,
        entries: [{ k: 'a', t: 'h', v: [['f', 1]] }],
      }),
    ],
    [
      '자료형을 모른다',
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        savedAt: 0,
        entries: [{ k: 'a', t: 'list', v: [] }],
      }),
    ],
    [
      '만료가 숫자가 아니다',
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        savedAt: 0,
        entries: [{ k: 'a', t: 's', v: '1', e: 'soon' }],
      }),
    ],
  ]

  for (const [name, content] of corruptions) {
    it(`${name}: 아무것도 들이지 않고, 파일을 지우지 않고 옆으로 치운다`, async () => {
      const path = tempPath()
      saveStoreSnapshot(store(), path) // 디렉터리를 만든다
      // 앞쪽에 정상 항목이 있어도 하나라도 틀리면 전부 버린다(반쯤 들인 저장소 금지).
      const withGoodPrefix = content.replace(
        '"entries":[',
        '"entries":[{"k":"good","t":"s","v":"1"},',
      )
      writeFileSync(path, withGoodPrefix)
      const target = store()
      const result = loadStoreSnapshot(target, path, 42)
      expect(result.kind).toBe('corrupt')
      expect(await target.keys()).toEqual([])
      expect(existsSync(path)).toBe(false)
      expect(readFileSync(`${path}.corrupt-42`, 'utf8')).toBe(withGoodPrefix)
    })
  }

  it('빈 저장소가 아니면 들이지 않는다', async () => {
    const target = store()
    await target.set('already', '1')
    expect(() => target.core.restore([])).toThrow(/빈 저장소/)
  })

  it('상한을 넘는 스냅샷은 하나도 들이지 않는다', () => {
    const source = new RedisCore(() => 0)
    for (let index = 0; index < 5; index += 1) source.set(`k${index}`, '1')
    const target = new RedisCore(() => 0, 3)
    expect(() => target.restore(source.snapshot())).toThrow(/OOM/)
    expect(target.keys()).toEqual([])
  })
})

describe('원자적 쓰기', () => {
  it('임시 파일에 다 쓴 뒤 바꿔 끼운다 — 남는 임시 파일이 없고, 이전 스냅샷은 통째로 바뀐다', async () => {
    const path = tempPath()
    const first = store()
    await first.set('generation', '1')
    saveStoreSnapshot(first, path)
    const second = store()
    await second.set('generation', '2')
    await second.set('extra', 'x')
    saveStoreSnapshot(second, path)

    const directory = join(path, '..')
    expect(readdirSync(directory)).toEqual(['store.json'])
    const target = store()
    expect(loadStoreSnapshot(target, path)).toEqual({ kind: 'restored', entries: 2 })
    expect(await target.get('generation')).toBe('2')
  })

  it('쓰다 죽어 임시 파일만 남아도 이전 스냅샷을 읽는다', async () => {
    const path = tempPath()
    const source = store()
    await source.set('committed', '1')
    saveStoreSnapshot(source, path)
    // rename 직전에 프로세스가 죽은 상황 — 반쯤 쓴 임시 파일이 남아 있다.
    writeFileSync(`${path}.tmp`, '{"version":1,"savedAt":0,"entries":[{"k":"half')
    const target = store()
    expect(loadStoreSnapshot(target, path)).toEqual({ kind: 'restored', entries: 1 })
    expect(await target.get('committed')).toBe('1')
  })
})
