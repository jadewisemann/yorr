import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { gameStateKey, roomKey } from '../../../room/keys.js'
import { initialDuelState, signal } from '../duelRules.js'
import type { DuelState } from '../duelState.js'
import { RedisDuelStateStore } from '../duelStateStore.js'

const ROOM_CODE = 'ROOM1'
const PLAYERS = ['player-1', 'player-2'] as const

/**
 * 검증. 락·SETNX·TTL 복사는 모킹으로 볼 수
 * 없어 **진짜 Redis**로 돈다(ADR-0004).
 *
 * 핵심 케이스는 **version 비증가 갱신 무시**다: 결투는 두 플레이어의 draw와 서버
 * 타임아웃이 같은 밀리초에 도착할 수 있어, 오래된 상태를 그대로 쓰는 규칙 함수의
 * 반환값(= no-op)이 반드시 버려져야 한다. 여기가 새면 이미 끝난 판정이 되살아난다.
 */
describeRedis('RedisDuelStateStore', () => {
  const redis = useRedis()

  const store = (): RedisDuelStateStore => new RedisDuelStateStore(redis())

  const state = (): DuelState => initialDuelState([...PLAYERS], 1_000, 2_000)

  it('초기화는 한 번만 성공한다(SETNX)', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    await expect(subject.initialize(ROOM_CODE, state())).rejects.toThrow('duel_already_initialized')
    expect((await subject.find(ROOM_CODE))?.version).toBe(1)
  })

  it('없는 방의 상태는 null이다', async () => {
    expect(await store().find('NOPE')).toBeNull()
  })

  it('version이 오른 갱신만 저장된다', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    const next = await subject.mutate(ROOM_CODE, (current) => signal(current, 5_000))

    expect(next?.version).toBe(2)
    expect(next?.phase).toBe('SIGNAL')
    expect((await subject.find(ROOM_CODE))?.phase).toBe('SIGNAL')
  })

  it('version이 그대로인 갱신은 무시된다(규칙 함수의 no-op)', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())
    await subject.mutate(ROOM_CODE, (current) => signal(current, 5_000))

    // signal은 phase가 SIGNAL이면 상태를 그대로 돌려준다 = version 비증가.
    const ignored = await subject.mutate(ROOM_CODE, (current) => signal(current, 9_000))

    expect(ignored).toBeNull()
    const stored = await subject.find(ROOM_CODE)
    expect(stored?.version).toBe(2)
    expect(stored?.signalAt).toBe(5_000)
  })

  it('version이 내려간 갱신도 무시된다 — 오래된 상태가 새 상태를 덮지 않는다', async () => {
    const subject = store()
    const initial = state()
    await subject.initialize(ROOM_CODE, initial)
    const signalled = await subject.mutate(ROOM_CODE, (current) => signal(current, 5_000))
    expect(signalled?.version).toBe(2)

    // 타임아웃 콜백이 들고 있던 옛 스냅샷을 그대로 쓰려는 상황.
    const stale = await subject.mutate(ROOM_CODE, () => initial)

    expect(stale).toBeNull()
    const stored = await subject.find(ROOM_CODE)
    expect(stored?.version).toBe(2)
    expect(stored?.phase).toBe('SIGNAL')
  })

  it('mutation이 null이면 아무것도 쓰지 않는다', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    expect(await subject.mutate(ROOM_CODE, () => null)).toBeNull()
    expect((await subject.find(ROOM_CODE))?.version).toBe(1)
  })

  it('상태가 없는 방의 mutate는 null이다', async () => {
    expect(await store().mutate('NOPE', (current) => signal(current, 1))).toBeNull()
  })

  it('방 TTL을 상태 키에 복사한다', async () => {
    const client = redis()
    await client.hset(roomKey(ROOM_CODE), 'phase', 'PLAYING')
    await client.pexpire(roomKey(ROOM_CODE), 30_000)

    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    const ttl = await client.pttl(gameStateKey(ROOM_CODE, 'DUEL'))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30_000)
  })

  it('방 TTL이 없으면 상태 키도 만료되지 않는다', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    // -1 = 키는 있고 TTL이 없음.
    expect(await redis().pttl(gameStateKey(ROOM_CODE, 'DUEL'))).toBe(-1)
  })

  it('락은 mutate가 끝나면 풀린다 — 연속 호출이 막히지 않는다', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    await subject.mutate(ROOM_CODE, (current) => signal(current, 5_000))
    const again = await subject.mutate(ROOM_CODE, (current) => ({
      ...current,
      version: current.version + 1,
      round: current.round + 1,
    }))

    expect(again?.version).toBe(3)
    expect(await redis().exists(`${gameStateKey(ROOM_CODE, 'DUEL')}:lock`)).toBe(0)
  })

  it('remove는 상태를 버린다', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    expect(await subject.remove(ROOM_CODE)).toBe(true)
    expect(await subject.remove(ROOM_CODE)).toBe(false)
    expect(await subject.find(ROOM_CODE)).toBeNull()
  })

  it('저장된 값이 결투 상태가 아니면 조용히 넘기지 않는다', async () => {
    await redis().set(gameStateKey(ROOM_CODE, 'DUEL'), '{"nope":true}')

    await expect(store().find(ROOM_CODE)).rejects.toThrow('invalid_duel_state')
  })

  it('lastRound 없는 상태는 필드 자체가 생략되어 저장된다(NON_NULL)', async () => {
    const subject = store()
    await subject.initialize(ROOM_CODE, state())

    const raw = await redis().get(gameStateKey(ROOM_CODE, 'DUEL'))
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '{}')).not.toHaveProperty('lastRound')
  })
})
