import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { gameStateKey, roomKey } from '../../../room/keys.js'
import { DAVINCI_CODE } from '../davinciCode.js'
import { RedisDavinciStateStore } from '../davinciStateStore.js'
import { dieDavinciState } from './davinciStateFixture.js'

/**
 * 다빈치 상태 저장소 — **이 파일은 없었다**(결투·탁구에는 있는데). SQLite의
 * "짝 맞추기" 기법을 따라, 저장소가 지켜야 할 계약을 **세 저장소가 공유하는
 * 계약**으로 본다:
 *
 *  - SETNX 이중 초기화 거부
 *  - 방 키의 PTTL 복사(게임 상태는 방보다 오래 살지 않는다)
 *  - **version 비증가 변이 무시**(늦게 도착한 판정이 앞의 판정을 덮지 않는다)
 *  - 상태 모양이 깨졌으면 조용히 넘기지 않고 던진다
 *  - 방 단위 락 직렬화
 */
const ROOM = 'ROOMDV'

describeRedis('RedisDavinciStateStore', () => {
  const redis = useRedis()
  const store = (): RedisDavinciStateStore => new RedisDavinciStateStore(redis())

  it('초기화는 한 번만 성공한다(SETNX)', async () => {
    const subject = store()
    await subject.initialize(ROOM, dieDavinciState())

    await expect(subject.initialize(ROOM, dieDavinciState())).rejects.toThrow(
      'davinci_already_initialized',
    )
    expect((await subject.find(ROOM))?.version).toBe(1)
  })

  it('없는 방은 null이다(오류가 아니다)', async () => {
    expect(await store().find(ROOM)).toBeNull()
    expect(await store().mutate(ROOM, (current) => current)).toBeNull()
    expect(await store().remove(ROOM)).toBe(false)
  })

  it('방 키의 남은 수명을 그대로 복사한다', async () => {
    await redis().hset(roomKey(ROOM), 'phase', 'PLAYING')
    await redis().pexpire(roomKey(ROOM), 30_000)

    await store().initialize(ROOM, dieDavinciState())

    const ttl = await redis().pttl(gameStateKey(ROOM, DAVINCI_CODE))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30_000)
  })

  it('방 키에 TTL이 없으면 상태 키도 만료시키지 않는다', async () => {
    await redis().hset(roomKey(ROOM), 'phase', 'PLAYING')
    await store().initialize(ROOM, dieDavinciState())

    expect(await redis().pttl(gameStateKey(ROOM, DAVINCI_CODE))).toBe(-1)
  })

  it('version이 오른 변이만 저장된다', async () => {
    const subject = store()
    await subject.initialize(ROOM, dieDavinciState())

    const next = await subject.mutate(ROOM, (current) => ({
      ...current,
      version: current.version + 1,
      turn: current.turn + 1,
    }))

    expect(next?.version).toBe(2)
    expect((await subject.find(ROOM))?.turn).toBe(2)
  })

  it('version이 그대로이거나 내려간 변이는 버린다(늦은 판정이 앞을 덮지 않는다)', async () => {
    const subject = store()
    await subject.initialize(ROOM, dieDavinciState())
    await subject.mutate(ROOM, (current) => ({ ...current, version: 5 }))

    // 규칙 함수가 상태를 그대로 돌려주는 경우 = no-op.
    expect(await subject.mutate(ROOM, (current) => current)).toBeNull()
    // 오래된 스냅샷을 그대로 쓰는 경우 = 되돌리면 안 된다.
    expect(
      await subject.mutate(ROOM, (current) => ({ ...current, version: current.version - 1 })),
    ).toBeNull()
    // 명시적 null도 "변이 없음"이다.
    expect(await subject.mutate(ROOM, () => null)).toBeNull()

    expect((await subject.find(ROOM))?.version).toBe(5)
  })

  it('변이가 끝나면 락이 풀린다', async () => {
    const subject = store()
    await subject.initialize(ROOM, dieDavinciState())

    await subject.mutate(ROOM, (current) => ({ ...current, version: 2 }))
    await subject.mutate(ROOM, (current) => ({ ...current, version: 3 }))

    expect(await redis().exists(`${gameStateKey(ROOM, DAVINCI_CODE)}:lock`)).toBe(0)
  })

  it('내용이 깨진 상태는 조용히 넘기지 않고 던진다', async () => {
    const subject = store()
    await subject.initialize(ROOM, dieDavinciState())
    // 배포 사이에 상태 모양이 바뀐 상황을 흉내낸다.
    await redis().set(gameStateKey(ROOM, DAVINCI_CODE), '{"version":1}')

    await expect(subject.find(ROOM)).rejects.toThrow('invalid_davinci_state')
    await expect(subject.mutate(ROOM, (current) => current)).rejects.toThrow(
      'invalid_davinci_state',
    )
  })

  it('JSON이 아닌 값도 같은 오류로 좁힌다', async () => {
    await redis().set(gameStateKey(ROOM, DAVINCI_CODE), 'not-json')
    await expect(store().find(ROOM)).rejects.toThrow('invalid_davinci_state')
  })

  it('remove는 상태를 버리고 두 번째 호출은 false다', async () => {
    const subject = store()
    await subject.initialize(ROOM, dieDavinciState())

    expect(await subject.remove(ROOM)).toBe(true)
    expect(await subject.remove(ROOM)).toBe(false)
    expect(await subject.find(ROOM)).toBeNull()
  })

  it('빈 roomId는 키를 만들지 않고 거부한다', async () => {
    await expect(store().initialize('   ', dieDavinciState())).rejects.toThrow(
      'roomId must not be blank',
    )
  })

  it('같은 방의 동시 변이는 한 줄로 서고 version이 그만큼 오른다', async () => {
    const subject = store()
    await subject.initialize(ROOM, dieDavinciState())

    await Promise.all([
      subject.mutate(ROOM, (current) => ({ ...current, version: current.version + 1 })),
      subject.mutate(ROOM, (current) => ({ ...current, version: current.version + 1 })),
    ])

    expect((await subject.find(ROOM))?.version).toBe(3)
  })
})

/** 다른 사람 상태를 섞지 않았는지 — 저장소는 직렬화만 책임진다. */
describeRedis('RedisDavinciStateStore — 여러 방', () => {
  const redis = useRedis()

  it('방마다 키가 갈린다', async () => {
    const subject = new RedisDavinciStateStore(redis())
    await subject.initialize('ROOMA', dieDavinciState({ version: 1, turn: 1 }))
    await subject.initialize('ROOMB', dieDavinciState({ version: 9, turn: 9 }))

    expect((await subject.find('ROOMA'))?.turn).toBe(1)
    expect((await subject.find('ROOMB'))?.turn).toBe(9)
  })
})
