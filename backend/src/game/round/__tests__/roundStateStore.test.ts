import { describe, expect, it } from 'vitest'
import { isRoundSyncError } from '../roundErrors.js'
import { RoundState } from '../roundState.js'
import { InMemoryRoundStateStore } from '../roundStateStore.js'
import { RoundSubmission } from '../roundSubmission.js'

/**
 * 구현이 프라미스 락으로 원자성을 얻으므로, 포트 계약 — 특히
 * `beforeStateChange` 시맨틱 — 을 여기서 직접 고정한다.
 */
describe('InMemoryRoundStateStore', () => {
  const noHeld = [false, false, false, false, false]
  const seed = async (
    store: InMemoryRoundStateStore,
    participants: string[] = ['player-a', 'player-b'],
    totalRounds = 12,
  ): Promise<void> => {
    await store.initialize('ROOM1', RoundState.start(1, participants, totalRounds))
  }

  it('이중 초기화는 ROUND_ALREADY_INITIALIZED다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store)

    await expect(seed(store)).rejects.toSatisfy((error: unknown) =>
      isRoundSyncError(error, 'ROUND_ALREADY_INITIALIZED'),
    )
  })

  it('초기화되지 않은 방의 전이는 ROUND_NOT_INITIALIZED다', async () => {
    const store = new InMemoryRoundStateStore()

    await expect(
      store.recordRollAtomically('ROOM1', 'player-a', 1, 1, noHeld, [1, 2, 3, 4, 5]),
    ).rejects.toSatisfy((error: unknown) => isRoundSyncError(error, 'ROUND_NOT_INITIALIZED'))
  })

  it('beforeStateChange가 실패하면 라운드 상태는 변하지 않는다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store)
    await store.recordRollAtomically('ROOM1', 'player-a', 1, 1, noHeld, [1, 2, 3, 4, 5])

    await expect(
      store.submitAtomically('ROOM1', submission('player-a'), async () => {
        throw new Error('redis unavailable')
      }),
    ).rejects.toThrow('redis unavailable')

    const state = await store.findByRoomId('ROOM1')
    // 미제출로 남아 재시도할 수 있어야 한다 — 점수 저장 실패의 계약.
    expect(state?.submittedPlayerIds).toEqual([])
    expect(state?.activePlayerId).toBe('player-a')
    expect(state?.activeRollCount).toBe(1)
  })

  it('beforeStateChange는 검증 통과 후에만, 커밋 전에 한 번 돈다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store)
    await store.recordRollAtomically('ROOM1', 'player-a', 1, 1, noHeld, [1, 2, 3, 4, 5])
    const seen: Array<string | undefined> = []

    // 남의 턴 제출은 콜백까지 가지 않는다.
    await expect(
      store.submitAtomically('ROOM1', submission('player-b'), () => {
        seen.push('called')
      }),
    ).rejects.toSatisfy((error: unknown) => isRoundSyncError(error, 'NOT_ACTIVE_PLAYER'))
    expect(seen).toEqual([])

    await store.submitAtomically('ROOM1', submission('player-a'), async () => {
      // 커밋 전이므로 저장된 상태는 아직 이전 턴이다.
      seen.push((await store.findByRoomId('ROOM1'))?.activePlayerId)
    })
    expect(seen).toEqual(['player-a'])
    expect((await store.findByRoomId('ROOM1'))?.activePlayerId).toBe('player-b')
  })

  /** 같은 방의 두 제출이 콜백 사이에 끼어들어 라운드를 두 번 완료시키면 안 된다. */
  it('같은 방의 동시 제출을 직렬화한다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store, ['player-a'])
    await store.recordRollAtomically('ROOM1', 'player-a', 1, 1, noHeld, [1, 2, 3, 4, 5])
    const slowCallback = () => new Promise<void>((resolve) => setImmediate(resolve))

    const [first, second] = await Promise.allSettled([
      store.submitAtomically('ROOM1', submission('player-a'), slowCallback),
      store.submitAtomically('ROOM1', submission('player-a'), slowCallback),
    ])

    expect(first?.status).toBe('fulfilled')
    // 두 번째는 이미 다음 라운드로 넘어간 상태를 보고 거부된다(중복 완료 없음).
    expect(second?.status).toBe('rejected')
    expect((await store.findByRoomId('ROOM1'))?.roundNumber).toBe(2)
  })

  it('스테일한 턴의 autoRoll·expire는 빈 결과다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store)

    expect(await store.autoRollAtomically('ROOM1', 2, 'player-a', [1, 1, 1, 1, 1])).toBeUndefined()
    expect(await store.autoRollAtomically('ROOM1', 1, 'player-b', [1, 1, 1, 1, 1])).toBeUndefined()
    expect(await store.expireAtomically('ROOM1', 1, 'player-b')).toBeUndefined()
    expect(
      await store.autoRollAtomically('MISSING', 1, 'player-a', [1, 1, 1, 1, 1]),
    ).toBeUndefined()

    // 굴림을 다 쓴 턴도 빈 결과 — 호출자는 점수 기록으로 넘어간다.
    for (let rollCount = 1; rollCount <= 3; rollCount += 1) {
      await store.recordRollAtomically('ROOM1', 'player-a', 1, rollCount, noHeld, [1, 2, 3, 4, 5])
    }
    expect(await store.autoRollAtomically('ROOM1', 1, 'player-a', [1, 1, 1, 1, 1])).toBeUndefined()
  })

  it('끝난 게임은 스테일 턴으로 취급한다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store, ['player-a'], 1)
    await store.recordRollAtomically('ROOM1', 'player-a', 1, 1, noHeld, [1, 2, 3, 4, 5])
    await store.submitAtomically('ROOM1', submission('player-a'), () => {})

    expect((await store.findByRoomId('ROOM1'))?.finished).toBe(true)
    expect(await store.expireAtomically('ROOM1', 1, 'player-a')).toBeUndefined()
    expect(await store.autoRollAtomically('ROOM1', 1, 'player-a', [1, 1, 1, 1, 1])).toBeUndefined()
  })

  it('참가자 제거는 상태가 있을 때만 값을 준다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store, ['player-a', 'player-b', 'player-c'])
    await store.recordRollAtomically('ROOM1', 'player-a', 1, 1, noHeld, [1, 2, 3, 4, 5])
    await store.submitAtomically('ROOM1', submission('player-a'), () => {})

    expect(await store.removeParticipantAtomically('MISSING', 'player-a')).toBeUndefined()
    const removed = await store.removeParticipantAtomically('ROOM1', 'player-c')
    expect(removed?.participantOrder).toEqual(['player-a', 'player-b'])
    expect((await store.findByRoomId('ROOM1'))?.participantOrder).toEqual(['player-a', 'player-b'])
  })

  it('roomIds는 순회 중 remove에 안전한 복사본이다', async () => {
    const store = new InMemoryRoundStateStore()
    await seed(store)
    await store.initialize('ROOM2', RoundState.start(1, ['player-a']))

    const roomIds = await store.roomIds()
    expect(roomIds.toSorted()).toEqual(['ROOM1', 'ROOM2'])
    for (const roomId of roomIds) expect(await store.remove(roomId)).toBe(true)

    expect(await store.roomIds()).toEqual([])
    expect(await store.remove('ROOM1')).toBe(false)
  })

  it('빈 roomId는 거부한다', async () => {
    const store = new InMemoryRoundStateStore()

    await expect(store.findByRoomId(' ')).rejects.toThrow('roomId must not be blank')
  })
})

const submission = (playerId: string): RoundSubmission =>
  new RoundSubmission(playerId, 1, [1, 2, 3, 4, 5], 'smallStraight')
