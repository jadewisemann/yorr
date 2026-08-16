import { beforeEach, describe, expect, it } from 'vitest'
import { isRoundSyncError } from '../roundErrors.js'
import { InMemoryRoundStateStore } from '../roundStateStore.js'
import { RoundSynchronizationService, seededDieRoller } from '../roundSynchronizationService.js'

/**
 * backend-java `RoundSynchronizationServiceTest`의 이식.
 *
 * Java의 동시성 케이스(`advancesOnlyAfterEachPlayerSubmitsInTurnOrder`가 20명
 * 순차 제출인 것과 별개로 존재하던 스레드 테스트)는 2.4에서 방 단위 프라미스 락
 * 테스트로 이미 옮겼다 — 여기서는 서비스 표면만 본다.
 */
describe('RoundSynchronizationService', () => {
  let store: InMemoryRoundStateStore
  let service: RoundSynchronizationService

  beforeEach(() => {
    store = new InMemoryRoundStateStore()
    // Java 테스트의 `() -> 1`. 다섯 개가 전부 1인 주사위라 제출 페이로드를 고정할 수 있다.
    service = new RoundSynchronizationService(store, { dieRoller: () => 1 })
  })

  it('라운드 초기화 전 제출을 거부한다', async () => {
    await expect(service.submit('room-a', 'player-a', payload(1))).rejects.toSatisfy((error) =>
      isRoundSyncError(error, 'ROUND_NOT_INITIALIZED'),
    )
  })

  it('같은 방을 두 번 초기화하지 않는다', async () => {
    await service.initialize('room-a', 1, ['player-a'])

    await expect(service.initialize('room-a', 1, ['player-a'])).rejects.toSatisfy((error) =>
      isRoundSyncError(error, 'ROUND_ALREADY_INITIALIZED'),
    )
  })

  it('참가자 전원이 순서대로 제출해야 다음 라운드로 넘어간다', async () => {
    const participants = Array.from({ length: 20 }, (_, index) => `player-${index}`)
    await service.initialize('room-a', 1, participants)

    const completions = []
    for (const playerId of participants) {
      await service.recordRoll('room-a', playerId, { roundNumber: 1, rollCount: 1, held: noHeld() })
      const result = await service.submit('room-a', playerId, payload(1))
      if (result.completedRound !== null) completions.push(result.completedRound)
    }

    expect(completions).toHaveLength(1)
    const state = await store.findByRoomId('room-a')
    expect(state?.roundNumber).toBe(2)
    expect(state?.submittedPlayerIds).toEqual([])
    expect(state?.activePlayerId).toBe('player-0')
  })

  it('제거한 방은 다시 초기화할 수 있다', async () => {
    await service.initialize('room-a', 1, ['player-a'])
    await service.recordRoll('room-a', 'player-a', {
      roundNumber: 1,
      rollCount: 1,
      held: noHeld(),
    })

    await service.remove('room-a')
    await service.initialize('room-a', 4, ['player-b'])

    expect((await store.findByRoomId('room-a'))?.roundNumber).toBe(4)
  })

  /** 점수 저장이 실패하면 그 플레이어는 미제출로 남아 재시도할 수 있어야 한다. */
  it('커밋 전 콜백이 실패하면 제출을 기록하지 않는다', async () => {
    await service.initialize('room-a', 1, ['player-a'])
    await service.recordRoll('room-a', 'player-a', {
      roundNumber: 1,
      rollCount: 1,
      held: noHeld(),
    })

    await expect(
      service.submit('room-a', 'player-a', payload(1), () => {
        throw new Error('score store failed')
      }),
    ).rejects.toThrow('score store failed')

    const state = await store.findByRoomId('room-a')
    expect(state?.roundNumber).toBe(1)
    expect(state?.submittedPlayerIds).toEqual([])
  })

  /* ------------------------------------------------ Java에 없던 계약: 서버 RNG 시임 */

  /**
   * 주사위의 권위는 서버다(DESIGN.md 원칙 1). 굴림 페이로드에 dice가 없다는 사실
   * 자체가 계약이라, 서비스가 **직접** 다섯 개를 만들어 넣는지 고정해 둔다.
   */
  it('굴림 페이로드가 아니라 서버 RNG가 주사위를 만든다', async () => {
    const rolls = [2, 3, 4, 5, 6]
    let index = 0
    const seeded = new RoundSynchronizationService(store, {
      dieRoller: () => rolls[index++ % rolls.length] as number,
    })
    await seeded.initialize('room-a', 1, ['player-a'])

    const state = await seeded.recordRoll('room-a', 'player-a', {
      roundNumber: 1,
      rollCount: 1,
      held: noHeld(),
    })

    expect(state.activeDice).toEqual(rolls)
  })

  /** 시드를 고정하면 같은 판이 재현된다 — 실패한 판을 테스트로 되살릴 수 있어야 한다. */
  it('같은 시드는 같은 주사위를 만든다', async () => {
    const first = new RoundSynchronizationService(new InMemoryRoundStateStore(), {
      dieRoller: seededDieRoller(42),
    })
    const second = new RoundSynchronizationService(new InMemoryRoundStateStore(), {
      dieRoller: seededDieRoller(42),
    })
    await first.initialize('room-a', 1, ['player-a'])
    await second.initialize('room-a', 1, ['player-a'])

    const roll = { roundNumber: 1, rollCount: 1, held: noHeld() }
    const left = await first.recordRoll('room-a', 'player-a', roll)
    const right = await second.recordRoll('room-a', 'player-a', roll)

    expect(left.activeDice).toEqual(right.activeDice)
    expect(left.activeDice?.every((die) => die >= 1 && die <= 6)).toBe(true)
  })
})

const payload = (roundNumber: number) => ({
  roundNumber,
  dice: [1, 1, 1, 1, 1],
  category: 'ones',
})

const noHeld = (): boolean[] => [false, false, false, false, false]
