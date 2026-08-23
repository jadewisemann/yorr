import { describe, expect, it } from 'vitest'
import { InMemoryRoundStateStore, RoundSynchronizationService } from '../../round/index.js'
import {
  OrphanedRoundStateSweeper,
  SWEEP_INTERVAL_MS,
  type SweepSchedule,
  type SweepScheduler,
} from '../orphanedRoundStateSweeper.js'
import type { RoundTimerCancelPort, SweeperRoomService } from '../reconnectPorts.js'

/**
 * backend-java `OrphanedRoundStateSweeperTest` 이식.
 *
 * Java와 같이 **라운드 상태 저장소는 진짜 구현**(`InMemoryRoundStateStore` +
 * `RoundSynchronizationService`)을 쓴다 — 순회 중 remove가 안전한지가 이 테스트의
 * 절반이라 가짜 목록으로는 검증되지 않는다.
 */
describe('OrphanedRoundStateSweeper', () => {
  /**
   * Redis TTL은 서버 메모리를 청소해주지 않는다. 방이 만료로 사라지면 라운드 상태를
   * 회수할 경로가 유예 타이머뿐인데 그 예약은 재시작에 사라진다 — 그래서 스윕이 받쳐야 한다.
   */
  it('방이 사라진 라운드 상태를 걷어낸다', async () => {
    const fixture = sweeperFixture({ 'gone-room': null })
    await fixture.rounds.initialize('gone-room', 1, ['player-a'])

    expect(await fixture.sweeper.sweep()).toBe(1)

    expect(await fixture.rounds.findByRoomId('gone-room')).toBeUndefined()
    // 타이머를 먼저 끊어야 방 없는 상태로 만료가 발화하지 않는다.
    expect(fixture.timers.cancelled).toEqual(['gone-room'])
  })

  it('살아있는 방의 라운드 상태는 남긴다', async () => {
    const fixture = sweeperFixture({ 'live-room': 'PLAYING' })
    await fixture.rounds.initialize('live-room', 1, ['player-a'])

    expect(await fixture.sweeper.sweep()).toBe(0)

    expect(await fixture.rounds.findByRoomId('live-room')).toBeDefined()
    expect(fixture.timers.cancelled).toEqual([])
  })

  /** 순회 중 remove를 호출하므로 살아있는 키 집합을 쓰면 터진다. 여러 방이 섞여도 안전해야 한다. */
  it('두 종류가 섞여 있어도 사라진 방만 걷어낸다', async () => {
    const fixture = sweeperFixture({ 'gone-room': null, 'live-room': 'PLAYING' })
    await fixture.rounds.initialize('gone-room', 1, ['player-a'])
    await fixture.rounds.initialize('live-room', 1, ['player-b'])

    expect(await fixture.sweeper.sweep()).toBe(1)

    expect(await fixture.rounds.findByRoomId('gone-room')).toBeUndefined()
    expect(await fixture.rounds.findByRoomId('live-room')).toBeDefined()
  })

  /**
   * Java에 없는 케이스. 순서가 뒤집히면 이미 지운 방의 마감이 발화해 라운드 상태를
   * 다시 만든다 — 그래서 순서 자체를 고정한다.
   */
  it('cancelRoom → remove 순서로 회수한다', async () => {
    const order: string[] = []
    const store = new InMemoryRoundStateStore()
    const rounds = new RoundSynchronizationService(store)
    await rounds.initialize('gone-room', 1, ['player-a'])

    const sweeper = new OrphanedRoundStateSweeper({
      roundStates: {
        roomIds: () => rounds.roomIds(),
        remove: async (roomId) => {
          order.push(`remove:${roomId}`)
          return rounds.remove(roomId)
        },
      },
      timers: {
        cancelRoom: async (roomId) => {
          order.push(`cancel:${roomId}`)
        },
      },
      rooms: goneRooms(),
    })

    await sweeper.sweep()

    expect(order).toEqual(['cancel:gone-room', 'remove:gone-room'])
  })

  /** 라운드 상태가 하나도 없으면 방 조회도 하지 않는다. */
  it('걷어낼 것이 없으면 0을 돌려준다', async () => {
    const fixture = sweeperFixture({})

    expect(await fixture.sweeper.sweep()).toBe(0)
    expect(fixture.roomLookups).toEqual([])
  })

  /**
   * 주기 실행은 주입 가능한 시임이다 — 테스트가 실시간 sleep(5분)에 기대지 않고
   * 예약된 작업을 직접 발화시킨다.
   */
  it('start()가 5분 주기로 스윕을 예약하고 stop()이 해제한다', async () => {
    const scheduler = new FakeSweepScheduler()
    const fixture = sweeperFixture({ 'gone-room': null }, scheduler)
    await fixture.rounds.initialize('gone-room', 1, ['player-a'])

    fixture.sweeper.start()
    expect(scheduler.intervalMs).toBe(SWEEP_INTERVAL_MS)

    await scheduler.fire()
    expect(await fixture.rounds.findByRoomId('gone-room')).toBeUndefined()

    fixture.sweeper.stop()
    expect(scheduler.stopped).toBe(true)
  })

  it('start()는 멱등이다 — 두 번 불러도 예약이 하나다', () => {
    const scheduler = new FakeSweepScheduler()
    const fixture = sweeperFixture({}, scheduler)

    fixture.sweeper.start()
    fixture.sweeper.start()

    expect(scheduler.scheduledCount).toBe(1)
  })

  /** 한 주기가 던져도 예약은 살아남아야 한다(Spring `@Scheduled`가 다음 주기에 재시도하듯). */
  it('주기 실행이 던져도 onError로 흘리고 예약을 유지한다', async () => {
    const scheduler = new FakeSweepScheduler()
    const failures: unknown[] = []
    const sweeper = new OrphanedRoundStateSweeper(
      {
        roundStates: {
          roomIds: async () => {
            throw new Error('redis down')
          },
          remove: async () => true,
        },
        timers: { cancelRoom: async () => {} },
        rooms: goneRooms(),
      },
      { scheduler, onError: (error) => failures.push(error) },
    )

    sweeper.start()
    await scheduler.fire()

    expect(failures).toHaveLength(1)
    expect(scheduler.stopped).toBe(false)
  })
})

class RecordingTimerCancel implements RoundTimerCancelPort {
  readonly cancelled: string[] = []

  async cancelRoom(roomId: string): Promise<void> {
    this.cancelled.push(roomId)
  }
}

/** Java 테스트의 `FakeRoundDeadlineScheduler`와 같은 취지 — 발화 시점을 테스트가 쥔다. */
class FakeSweepScheduler implements SweepScheduler {
  intervalMs: number | null = null
  task: (() => void) | null = null
  stopped = false
  scheduledCount = 0

  every(intervalMs: number, task: () => void): SweepSchedule {
    this.intervalMs = intervalMs
    this.task = task
    this.scheduledCount += 1
    return {
      stop: () => {
        this.stopped = true
      },
    }
  }

  /** 예약된 주기 한 번을 발화하고, 그 안에서 뜬 마이크로태스크가 끝날 때까지 기다린다. */
  async fire(): Promise<void> {
    this.task?.()
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/** roomId → phase. null이면 "방이 사라졌다"(`roomNotFound` 스냅샷 자리). */
type RoomPhases = Readonly<Record<string, string | null>>

const sweeperFixture = (phases: RoomPhases, scheduler?: SweepScheduler) => {
  const rounds = new RoundSynchronizationService(new InMemoryRoundStateStore())
  const timers = new RecordingTimerCancel()
  const roomLookups: string[] = []
  const rooms: SweeperRoomService = {
    getSnapshot: async (roomId) => {
      roomLookups.push(roomId)
      return { phase: phases[roomId] ?? null }
    },
  }

  const sweeper = new OrphanedRoundStateSweeper(
    { roundStates: rounds, timers, rooms },
    scheduler === undefined ? {} : { scheduler },
  )
  return { rounds, timers, rooms, roomLookups, sweeper }
}

/** 모든 방이 사라진 것으로 답하는 대역. */
const goneRooms = (): SweeperRoomService => ({
  getSnapshot: async () => ({ phase: null }),
})
