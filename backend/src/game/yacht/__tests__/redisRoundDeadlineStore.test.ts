import type { Redis } from 'ioredis'
import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { roomKey } from '../../../room/keys.js'
import { RedisRoundDeadlineStore } from '../redisRoundDeadlineStore.js'

/**
 * 마감 시각 영속화의 저장소 계약(deploy/PLAN.md PR 6).
 *
 * **모킹으로 검증할 수 없는 것만 둔다**(ADR-0004): 방 키 PTTL 복사, 라운드 번호가
 * 일치할 때만 지우는 조건 삭제, 그리고 손상된 값을 만났을 때의 동작. 마지막 것이
 * 특히 중요하다 — 부팅 재무장이 이 저장소를 읽으므로, 여기서 던지면 **한 방의 손상된
 * 값이 나머지 방의 복구를 전부 막는다.**
 */
const ROOM = 'ROOM1'

describeRedis('RedisRoundDeadlineStore', () => {
  const redis = useRedis()

  const key = (roomId = ROOM): string => `${roomKey(roomId)}:game:YACHT_DICE:deadline`

  const seed = async (ttlMs?: number): Promise<RedisRoundDeadlineStore> => {
    const client: Redis = redis()
    await client.hset(roomKey(ROOM), 'phase', 'PLAYING')
    if (ttlMs !== undefined) await client.pexpire(roomKey(ROOM), ttlMs)
    return new RedisRoundDeadlineStore(client)
  }

  it('저장한 마감을 그대로 되읽는다', async () => {
    const store = await seed()

    await store.save(ROOM, { roundNumber: 3, deadline: 1_700_000_000_000 })

    await expect(store.find(ROOM)).resolves.toEqual({
      roundNumber: 3,
      deadline: 1_700_000_000_000,
    })
  })

  /**
   * `null`과 "키가 없음"은 뜻이 다르다. null은 시계를 걸지 않은 턴(연습 방)이고,
   * 키가 없으면 진행 중인 턴 자체가 없다 — 재무장이 그 둘을 갈라 다룬다.
   */
  it('시계 없는 턴의 null과 기록 없음을 구별한다', async () => {
    const store = await seed()

    await store.save(ROOM, { roundNumber: 1, deadline: null })

    await expect(store.find(ROOM)).resolves.toEqual({ roundNumber: 1, deadline: null })
    await expect(store.find('NOBODY')).resolves.toBeUndefined()
  })

  it('방 키의 남은 TTL을 마감 키에 복사한다', async () => {
    const store = await seed(60_000)

    await store.save(ROOM, { roundNumber: 1, deadline: 1 })

    const ttl = await redis().pttl(key())
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60_000)
  })

  /** 방보다 오래 사는 마감은 고아다. 방에 TTL이 없으면 복사할 것도 없다. */
  it('방에 TTL이 없으면 마감 키에도 걸지 않는다', async () => {
    const store = await seed()

    await store.save(ROOM, { roundNumber: 1, deadline: 1 })

    expect(await redis().pttl(key())).toBe(-1)
  })

  it('라운드 번호가 일치할 때만 지운다', async () => {
    const store = await seed()
    await store.save(ROOM, { roundNumber: 4, deadline: 1 })

    await store.remove(ROOM, 3)
    await expect(store.find(ROOM)).resolves.toEqual({ roundNumber: 4, deadline: 1 })

    await store.remove(ROOM, 4)
    await expect(store.find(ROOM)).resolves.toBeUndefined()
  })

  it('removeRoom은 라운드 번호를 보지 않는다', async () => {
    const store = await seed()
    await store.save(ROOM, { roundNumber: 9, deadline: 1 })

    await store.removeRoom(ROOM)

    await expect(store.find(ROOM)).resolves.toBeUndefined()
  })

  /**
   * 손상된 값에서 **던지지 않는 것이 계약이다.** 던지면 부팅 재무장 순회가 한 방
   * 때문에 멈추고, 그러면 이 PR이 없앤 문제(진행 중 게임 전멸)가 그대로 돌아온다.
   * undefined를 내면 그 방만 fail-closed로 닫힌다.
   */
  it('손상된 값은 없는 것으로 다룬다', async () => {
    const store = await seed()

    for (const broken of ['', 'not json', '[]', '{}', '{"roundNumber":"3"}', '{"deadline":1}']) {
      await redis().set(key(), broken)
      await expect(store.find(ROOM)).resolves.toBeUndefined()
    }
  })

  it('빈 roomId는 거부한다', async () => {
    const store = await seed()

    await expect(store.find('  ')).rejects.toThrow('roomId must not be blank')
    await expect(store.save('  ', { roundNumber: 1, deadline: 1 })).rejects.toThrow(
      'roomId must not be blank',
    )
  })
})
