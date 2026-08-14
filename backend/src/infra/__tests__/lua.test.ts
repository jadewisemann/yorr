import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { type LuaScript, registerLuaScripts, runLua, runLuaNumber, VARIADIC_KEYS } from '../lua.js'

// 방 스크립트의 축소판 — 반환 코드가 계약이라는 성질만 남겼다.
const SEAT_SCRIPT: LuaScript = {
  name: 'yorrTestSeat',
  numberOfKeys: 1,
  lua: `
    local capacity = tonumber(ARGV[2])
    if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return 4 end
    if redis.call('HLEN', KEYS[1]) >= capacity then return 3 end
    redis.call('HSET', KEYS[1], ARGV[1], '1')
    return 1
  `,
}

const DELETE_ALL_SCRIPT: LuaScript = {
  name: 'yorrTestDeleteAll',
  numberOfKeys: VARIADIC_KEYS,
  lua: `
    local removed = 0
    for i = 1, #KEYS do removed = removed + redis.call('DEL', KEYS[i]) end
    return removed
  `,
}

describeRedis('Lua 스크립트 등록 체계', () => {
  const redis = useRedis()

  it('반환 코드로 정원·중복을 구분한다', async () => {
    const client = redis()
    registerLuaScripts(client, [SEAT_SCRIPT])

    expect(await runLuaNumber(client, SEAT_SCRIPT, ['room:A:players'], ['p1', 2])).toBe(1)
    expect(await runLuaNumber(client, SEAT_SCRIPT, ['room:A:players'], ['p1', 2])).toBe(4)
    expect(await runLuaNumber(client, SEAT_SCRIPT, ['room:A:players'], ['p2', 2])).toBe(1)
    expect(await runLuaNumber(client, SEAT_SCRIPT, ['room:A:players'], ['p3', 2])).toBe(3)
  })

  it('동시에 들어와도 정원을 넘지 않는다', async () => {
    const client = redis()
    registerLuaScripts(client, [SEAT_SCRIPT])

    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        runLuaNumber(client, SEAT_SCRIPT, ['room:A:players'], [`p${i}`, 6]),
      ),
    )

    expect(results.filter((code) => code === 1)).toHaveLength(6)
    expect(await client.hlen('room:A:players')).toBe(6)
  })

  it('키 개수를 호출 시점에 정하는 스크립트도 등록된다', async () => {
    const client = redis()
    registerLuaScripts(client, [DELETE_ALL_SCRIPT])
    await client.mset('room:A', '1', 'room:A:players', '1')

    expect(
      await runLua(client, DELETE_ALL_SCRIPT, ['room:A', 'room:A:players', 'room:A:bots']),
    ).toBe(2)
  })

  it('같은 이름을 다시 등록해도 안전하다', async () => {
    const client = redis()
    registerLuaScripts(client, [SEAT_SCRIPT])
    registerLuaScripts(client, [SEAT_SCRIPT])

    expect(await runLuaNumber(client, SEAT_SCRIPT, ['room:A:players'], ['p1', 1])).toBe(1)
  })

  it('등록하지 않은 스크립트를 부르면 즉시 실패한다', async () => {
    await expect(
      runLua(redis(), { name: 'yorrTestMissing', numberOfKeys: 0, lua: 'return 1' }, []),
    ).rejects.toThrow('등록되지 않은 Lua 스크립트')
  })
})
