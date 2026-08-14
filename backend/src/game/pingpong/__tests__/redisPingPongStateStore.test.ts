import { beforeEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { gameStateKey, roomKey } from '../../../room/keys.js'
import { PING_PONG } from '../../catalog.js'
import { initial, ready, swing } from '../pingPongRules.js'
import { RedisPingPongStateStore } from '../pingPongStateStore.js'

/**
 * 진짜 Redis로만 검증되는 것들: SETNX 이중 초기화 거부 · 방 TTL 복사 ·
 * **version 비증가 변이 무시** · 동시 변이 직렬화(방 락).
 */
const ROOM = 'ROOMAA'
const P1 = 'player-1'
const P2 = 'player-2'

describeRedis('RedisPingPongStateStore', () => {
  const redis = useRedis()
  let store: RedisPingPongStateStore

  beforeEach(() => {
    store = new RedisPingPongStateStore(redis())
  })

  it('초기화는 한 번만 성공하고 상태를 그대로 되살린다', async () => {
    const state = initial([P1, P2], 1_000)

    await store.initialize(ROOM, state)

    expect(await store.find(ROOM)).toEqual(state)
    await expect(store.initialize(ROOM, state)).rejects.toThrow('ping_pong_already_initialized')
  })

  it('없는 방은 undefined다(오류가 아니다)', async () => {
    expect(await store.find(ROOM)).toBeUndefined()
    expect(await store.mutate(ROOM, (current) => current)).toBeUndefined()
    expect(await store.remove(ROOM)).toBe(false)
  })

  it('방 키의 남은 수명을 그대로 복사한다', async () => {
    await redis().hset(roomKey(ROOM), 'phase', 'PLAYING')
    await redis().pexpire(roomKey(ROOM), 30_000)

    await store.initialize(ROOM, initial([P1, P2], 1_000))

    const ttl = await redis().pttl(gameStateKey(ROOM, PING_PONG))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30_000)
  })

  it('version이 늘지 않는 변이는 쓰지 않는다', async () => {
    const state = initial([P1, P2], 1_000)
    await store.initialize(ROOM, state)

    // 규칙 함수가 "무시"로 돌려준 같은 상태 — 연습 스윙 전 ready가 그 경우다.
    expect(await store.mutate(ROOM, (current) => ready(current, P1, 1_100))).toBeUndefined()
    expect(await store.mutate(ROOM, () => null)).toBeUndefined()
    expect(await store.find(ROOM)).toEqual(state)

    const next = await store.mutate(ROOM, (current) => swing(current, P1, 0, 1_200, 0.5))
    expect(next?.version).toBe(2)
    expect((await store.find(ROOM))?.lastEvent?.type).toBe('PRACTICE')
  })

  it('같은 방의 동시 변이는 하나씩 직렬화된다', async () => {
    await store.initialize(ROOM, initial([P1, P2], 1_000))

    // 두 사람이 같은 순간에 연습 스윙을 보낸다 — 둘 다 반영되고 version이 2 늘어야 한다.
    await Promise.all([
      store.mutate(ROOM, (current) => swing(current, P1, 0, 1_100, 0.5)),
      store.mutate(ROOM, (current) => swing(current, P2, 0, 1_100, 0.5)),
    ])

    const state = await store.find(ROOM)
    expect(state?.version).toBe(3)
    expect(state?.lastInputSeq).toEqual({ [P1]: 0, [P2]: 0 })
  })

  it('폴트 없는 공은 fault 필드를 아예 싣지 않는다(NON_NULL 계약)', async () => {
    let state = initial([P1, P2], 1_000)
    state = swing(state, P1, 0, 1_100, 0.5)
    await store.initialize(ROOM, state)

    const raw = (await redis().get(gameStateKey(ROOM, PING_PONG))) as string
    expect(JSON.parse(raw)).not.toHaveProperty('ball.fault')
    // 되살린 값도 undefined다 — 다시 쓸 때 `"fault":null`이 새로 생기지 않는다.
    expect((await store.find(ROOM))?.ball.fault).toBeUndefined()
  })
})
