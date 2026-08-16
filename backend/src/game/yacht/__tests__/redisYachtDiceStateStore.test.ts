import type { Redis } from 'ioredis'
import { expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { ConflictError } from '../../../errors.js'
import { gameStateKey, roomKey } from '../../../room/keys.js'
import {
  isRoundSyncError,
  RoundState,
  RoundSubmission,
  type RoundSubmissionResult,
} from '../../round/index.js'
import { RedisYachtDiceStateStore } from '../redisYachtDiceStateStore.js'

/**
 * backend-java `RedisYachtDiceStateStoreIntegrationTest` 이식 + 그 테스트가 덮지
 * 않던 저장소 계약(락 고갈·TTL 복사·SETNX·SCAN·스냅샷 라운드트립).
 *
 * **모킹으로 검증할 수 없는 것만 여기 둔다**(ADR-0004): 방 락의 원자성, 방 키
 * PTTL 복사, `SET NX`, `SCAN` 패턴, 그리고 JSON 스냅샷이 도메인 객체로 정확히
 * 되살아나는가.
 */
const ROOM = 'ROOM1'
const OTHER_ROOM = 'ROOM2'
const HELD: readonly boolean[] = [false, false, false, false, false]
const DICE: readonly number[] = [1, 2, 3, 4, 5]

describeRedis('RedisYachtDiceStateStore', () => {
  const redis = useRedis()

  const stateKey = (roomId = ROOM): string => gameStateKey(roomId, 'YACHT_DICE')

  /** 진행 중인 방 하나 + 라운드 상태 초기화. Java 테스트의 `@BeforeEach reset` 자리. */
  const seed = async (
    options: { players?: string[]; ttlMs?: number; roomId?: string } = {},
  ): Promise<RedisYachtDiceStateStore> => {
    const roomId = options.roomId ?? ROOM
    const client: Redis = redis()
    await client.hset(roomKey(roomId), 'phase', 'PLAYING')
    if (options.ttlMs !== undefined) await client.pexpire(roomKey(roomId), options.ttlMs)
    const store = new RedisYachtDiceStateStore(client)
    await store.initialize(roomId, RoundState.start(1, options.players ?? ['player-a']))
    return store
  }

  it('게임별 상태를 Redis에서 그대로 되살린다', async () => {
    const store = await seed()

    await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)

    const state = await store.findByRoomId(ROOM)
    expect(state?.activeRollCount).toBe(1)
    expect(state?.activeDice).toEqual([1, 2, 3, 4, 5])
    expect(state?.activeHeld).toEqual([false, false, false, false, false])
  })

  it('같은 턴에 대한 동시 변경은 정확히 1건만 성공한다', async () => {
    const store = await seed()
    const roll = async (): Promise<boolean> => {
      try {
        await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)
        return true
      } catch {
        return false
      }
    }

    const results = await Promise.all([roll(), roll()])

    // 락이 없으면 둘 다 activeRollCount 0을 읽어 둘 다 성공한다 —
    // 직렬화된 뒤에는 두 번째가 rollCount 연속성(1 → 2)에 걸려 거부된다.
    expect([...results].sort()).toEqual([false, true])
    expect((await store.findByRoomId(ROOM))?.activeRollCount).toBe(1)
  })

  it('initialize는 SETNX다 — 이중 초기화는 ROUND_ALREADY_INITIALIZED', async () => {
    const store = await seed()

    let thrown: unknown
    try {
      await store.initialize(ROOM, RoundState.start(1, ['player-b']))
    } catch (error) {
      thrown = error
    }

    expect(isRoundSyncError(thrown, 'ROUND_ALREADY_INITIALIZED')).toBe(true)
    // 실패한 초기화는 기존 상태를 덮어쓰지 않는다.
    expect((await store.findByRoomId(ROOM))?.participantOrder).toEqual(['player-a'])
  })

  it('쓸 때마다 방 키의 PTTL을 복사한다 — 독립 TTL은 없다', async () => {
    const store = await seed({ ttlMs: 60_000 })
    const client: Redis = redis()

    // initialize 시점에 이미 복사돼 있다.
    const afterInit = await client.pttl(stateKey())
    expect(afterInit).toBeGreaterThan(0)
    expect(afterInit).toBeLessThanOrEqual(60_000)

    await client.pexpire(roomKey(ROOM), 120_000)
    await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)

    const afterWrite = await client.pttl(stateKey())
    expect(afterWrite).toBeGreaterThan(60_000)
    expect(afterWrite).toBeLessThanOrEqual(120_000)
  })

  it('방 키에 TTL이 없으면 상태 키도 무기한이다(스위퍼가 걷어간다)', async () => {
    const store = await seed()

    await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)

    // -1 = 키는 있고 TTL은 없음.
    expect(await redis().pttl(stateKey())).toBe(-1)
  })

  it('제출까지 담긴 스냅샷이 라운드트립한다', async () => {
    const store = await seed({ players: ['player-a', 'player-b'] })
    await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)

    const result: RoundSubmissionResult = await store.submitAtomically(
      ROOM,
      new RoundSubmission('player-a', 1, DICE, 'smallStraight'),
      () => {},
    )
    expect(result.completedRound).toBeNull()

    const restored = await store.findByRoomId(ROOM)
    expect(restored?.activePlayerId).toBe('player-b')
    expect(restored?.submittedPlayerIds).toEqual(['player-a'])
    const submission = restored?.submissions.get('player-a')
    expect(submission).toBeInstanceOf(RoundSubmission)
    expect(submission?.category).toBe('smallStraight')
    expect(submission?.dice).toEqual([1, 2, 3, 4, 5])
    // 턴이 넘어가면 굴림 상태는 초기화된다(JSON의 null이 그대로 살아온다).
    expect(restored?.activeDice).toBeNull()
    expect(restored?.activeHeld).toBeNull()
  })

  it('beforeStateChange가 던지면 상태는 무변화이고 락은 풀린다', async () => {
    const store = await seed()
    await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)

    await expect(
      store.submitAtomically(ROOM, new RoundSubmission('player-a', 1, DICE, 'choice'), () => {
        throw new Error('score store down')
      }),
    ).rejects.toThrow('score store down')

    const state = await store.findByRoomId(ROOM)
    expect(state?.submittedPlayerIds).toEqual([])
    expect(state?.activePlayerId).toBe('player-a')
    // 락이 남아 있으면 그 방은 5초간 아무 전이도 못 한다.
    expect(await redis().exists(`${stateKey()}:lock`)).toBe(0)
  })

  it('락 대기 예산을 넘기면 game_state_busy이고 남의 락은 풀지 않는다', async () => {
    const client: Redis = redis()
    await client.hset(roomKey(ROOM), 'phase', 'PLAYING')
    const store = new RedisYachtDiceStateStore(client, { lockWaitMs: 30, lockRetryMs: 5 })
    await store.initialize(ROOM, RoundState.start(1, ['player-a']))
    // 다른 요청이 잡고 있는 락(토큰이 다르다).
    await client.set(`${stateKey()}:lock`, 'someone-else', 'PX', 5_000)

    let thrown: unknown
    try {
      await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ConflictError)
    expect((thrown as ConflictError).code).toBe('game_state_busy')
    // 토큰 비교 해제가 없으면 여기서 남의 락이 사라진다.
    expect(await client.get(`${stateKey()}:lock`)).toBe('someone-else')
  })

  it('성공 경로는 락을 남기지 않는다', async () => {
    const store = await seed()

    await store.recordRollAtomically(ROOM, 'player-a', 1, 1, HELD, DICE)

    expect(await redis().exists(`${stateKey()}:lock`)).toBe(0)
  })

  it('상태가 없으면 변경은 ROUND_NOT_INITIALIZED, 조회는 undefined다', async () => {
    const store = new RedisYachtDiceStateStore(redis())

    expect(await store.findByRoomId('GHOST')).toBeUndefined()
    let thrown: unknown
    try {
      await store.recordRollAtomically('GHOST', 'player-a', 1, 1, HELD, DICE)
    } catch (error) {
      thrown = error
    }
    expect(isRoundSyncError(thrown, 'ROUND_NOT_INITIALIZED')).toBe(true)
  })

  it('스테일 턴의 autoRoll·expire는 undefined다(부수효과 없음)', async () => {
    const store = await seed({ players: ['player-a', 'player-b'] })

    expect(await store.autoRollAtomically(ROOM, 2, 'player-a', DICE)).toBeUndefined()
    expect(await store.expireAtomically(ROOM, 1, 'player-b')).toBeUndefined()
    const state = await store.findByRoomId(ROOM)
    expect(state?.roundNumber).toBe(1)
    expect(state?.activePlayerId).toBe('player-a')
    expect(state?.activeRollCount).toBe(0)
  })

  it('roomIds는 야추 상태 키만 걷어 방 코드를 돌려준다', async () => {
    const store = await seed()
    await seed({ roomId: OTHER_ROOM })
    const client: Redis = redis()
    // 다른 게임의 상태 키와 방 키 자체는 세지 않는다.
    await client.set(gameStateKey('ROOM3', 'DUEL'), '{}')
    await client.hset(roomKey('ROOM4'), 'phase', 'LOBBY')

    expect((await store.roomIds()).sort()).toEqual([ROOM, OTHER_ROOM].sort())
  })

  it('remove는 실제 삭제 여부를 돌려준다', async () => {
    const store = await seed()

    expect(await store.remove(ROOM)).toBe(true)
    expect(await store.remove(ROOM)).toBe(false)
    expect(await store.findByRoomId(ROOM)).toBeUndefined()
  })

  it('손상된 스냅샷은 invalid_yacht_state로 드러난다 — 조용히 통과시키지 않는다', async () => {
    const client: Redis = redis()
    const store = new RedisYachtDiceStateStore(client)
    await client.set(stateKey(), '{"roundNumber":"열두번째"}')

    let thrown: unknown
    try {
      await store.findByRoomId(ROOM)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ConflictError)
    expect((thrown as ConflictError).code).toBe('invalid_yacht_state')
    expect((thrown as ConflictError).cause).toBeDefined()
  })
})
