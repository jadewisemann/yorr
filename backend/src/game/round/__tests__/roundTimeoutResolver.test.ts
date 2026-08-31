import { beforeEach, describe, expect, it } from 'vitest'
import type {
  ConfirmedScore,
  RoundSubmitPayload,
  ScoreRoundSubmissionOutcome,
  ScoreRoundSubmissionPort,
} from '../roundPorts.js'
import type { RoundSubmissionResult } from '../roundState.js'
import { InMemoryRoundStateStore } from '../roundStateStore.js'
import { RoundSynchronizationService } from '../roundSynchronizationService.js'
import { RoundTimeoutResolver } from '../roundTimeoutResolver.js'
import { FakeOpenCategories, FakeRoomService, RecordingBroadcaster } from './testDoubles.js'

/**
 * 라운드 마감 처리 5종.
 *
 * 점수 계층은 **그 서비스가 지켜야 할 계약을 그대로 흉내 내는 대역**으로 세운다
 * (라운드 검증 후·커밋 전에 점수를 확정하고, 확정이 던지면 라운드 상태가 무변화로
 * 남는다). 대역 자리에 진짜 구현을 끼워도 테스트는 그대로 통과해야 한다.
 */
describe('RoundTimeoutResolver', () => {
  const NOW = Date.parse('2026-07-26T00:00:00Z')
  const NO_HELD = [false, false, false, false, false]

  let store: InMemoryRoundStateStore
  /** resolver가 쓰는 서비스. 자동 굴림은 항상 1이 나온다. */
  let synchronizationService: RoundSynchronizationService
  /** 플레이어가 직접 굴린 것처럼 상태를 만들 때 쓴다. 항상 6이 나온다 — 자동 굴림과 구분된다. */
  let playerRolls: RoundSynchronizationService
  let scoreRoundSubmission: FakeScoreRoundSubmissionService
  let openCategories: FakeOpenCategories
  let roomService: FakeRoomService
  let broadcaster: RecordingBroadcaster
  let resolver: RoundTimeoutResolver

  beforeEach(() => {
    store = new InMemoryRoundStateStore()
    synchronizationService = new RoundSynchronizationService(store, { dieRoller: () => 1 })
    playerRolls = new RoundSynchronizationService(store, { dieRoller: () => 6 })
    openCategories = new FakeOpenCategories(['choice', 'yacht'])
    roomService = new FakeRoomService({ gameId: 'game-a', players: [] })
    broadcaster = new RecordingBroadcaster()
    scoreRoundSubmission = new FakeScoreRoundSubmissionService(synchronizationService, roomService)
    resolver = new RoundTimeoutResolver(
      { synchronizationService, scoreRoundSubmission, openCategories, roomService, broadcaster },
      {
        now: () => NOW,
        // 항상 마지막 후보를 고른다 — 랜덤 선택을 결정적으로 만든다.
        categoryPicker: (bound) => bound - 1,
      },
    )
  })

  it('시간이 다 된 플레이어를 대신해 한 번 굴리고 턴은 그대로 둔다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])

    const resolution = await resolver.resolve('room-a', 1, 'player-a')

    expect(resolution.kind).toBe('AUTO_ROLLED')
    const state = await store.findByRoomId('room-a')
    expect(state?.activeRollCount).toBe(1)
    expect(state?.activePlayerId).toBe('player-a')
    expect(state?.activeDice).toEqual([1, 1, 1, 1, 1])
    expect(onlyBroadcast().type).toBe('game.yacht_dice.dice.broadcast')
    expect(onlyBroadcast().payload).toEqual({
      playerId: 'player-a',
      roundNumber: 1,
      rollCount: 1,
      dice: [1, 1, 1, 1, 1],
      held: NO_HELD,
      auto: true,
    })
    expect(scoreRoundSubmission.confirmed).toEqual([])
  })

  it('마지막 굴림에서 킵한 주사위를 유지한다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])
    await playerRolls.recordRoll('room-a', 'player-a', {
      roundNumber: 1,
      rollCount: 1,
      held: NO_HELD,
    })
    // 두 번째 굴림에서 1·2번 주사위를 킵했다고 알린 뒤 시간이 지난 상황.
    await playerRolls.recordRoll('room-a', 'player-a', {
      roundNumber: 1,
      rollCount: 2,
      held: [true, true, false, false, false],
    })

    await resolver.resolve('room-a', 1, 'player-a')

    const state = await store.findByRoomId('room-a')
    expect(state?.activeRollCount).toBe(3)
    // 킵한 두 칸은 6으로 남고, 나머지 세 칸만 다시 굴렸다(1).
    expect(state?.activeDice).toEqual([6, 6, 1, 1, 1])
    expect(state?.activeHeld).toEqual([true, true, false, false, false])
  })

  it('굴림이 남지 않았으면 비어 있는 족보를 기록하고 턴을 넘긴다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])
    await rollThreeTimes()

    const resolution = await resolver.resolve('room-a', 1, 'player-a')

    expect(resolution.kind).toBe('ADVANCED')
    expect(resolution.kind === 'ADVANCED' && resolution.advanced.state.activePlayerId).toBe(
      'player-b',
    )
    // 남은 후보(choice·yacht) 중에서 골랐다 — 이미 기록한 칸을 덮어쓰지 않는다.
    expect(scoreRoundSubmission.confirmed).toEqual([
      { gameId: 'game-a', playerId: 'player-a', roundNumber: 1, category: 'yacht', dice: SIXES },
    ])
    expect(onlyBroadcast().type).toBe('game.yacht_dice.score.update')
    expect((onlyBroadcast().payload as { playerId: string }).playerId).toBe('player-a')
  })

  it('유예 시간 안에 플레이어가 이미 제출했으면 아무것도 하지 않는다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])
    await rollThreeTimes()
    await synchronizationService.submit('room-a', 'player-a', {
      roundNumber: 1,
      dice: SIXES,
      category: 'yacht',
    })

    const resolution = await resolver.resolve('room-a', 1, 'player-a')

    expect(resolution.kind).toBe('STALE')
    expect(broadcaster.sent).toEqual([])
  })

  it('점수 저장이 실패해도 턴은 넘어간다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])
    await rollThreeTimes()
    scoreRoundSubmission.failure = new Error('redis unavailable')

    const resolution = await resolver.resolve('room-a', 1, 'player-a')

    // 점수를 남기지 못해도 턴은 멈추지 않는다 — 게임이 여기서 굳으면 아무도 진행할 수 없다.
    expect(resolution.kind).toBe('ADVANCED')
    expect(resolution.kind === 'ADVANCED' && resolution.advanced.state.activePlayerId).toBe(
      'player-b',
    )
    expect(broadcaster.typesFor('room-a')).toEqual([])
  })

  /* ------------------------------------------------ 계약: 강등 경로의 나머지 가지 */

  /** 진행 중인 게임을 찾지 못하면 점수 없이 진행한다 — 여기서 멈추면 방이 얼어붙는다. */
  it('gameId가 없으면 점수 없이 턴을 넘긴다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])
    await rollThreeTimes()
    roomService.snapshot = { gameId: null, players: [] }

    const resolution = await resolver.resolve('room-a', 1, 'player-a')

    expect(resolution.kind).toBe('ADVANCED')
    expect(scoreRoundSubmission.confirmed).toEqual([])
    expect(broadcaster.typesFor('room-a')).toEqual([])
  })

  it('남은 족보가 없으면 점수 없이 턴을 넘긴다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])
    await rollThreeTimes()
    openCategories.categories = []

    const resolution = await resolver.resolve('room-a', 1, 'player-a')

    expect(resolution.kind).toBe('ADVANCED')
    expect(scoreRoundSubmission.confirmed).toEqual([])
  })

  /** 족보 조회 자체가 던져도(2.6이 Redis를 탄다) 진행은 멈추지 않는다. */
  it('족보 조회가 실패해도 점수 없이 턴을 넘긴다', async () => {
    await synchronizationService.initialize('room-a', 1, ['player-a', 'player-b'])
    await rollThreeTimes()
    openCategories.failure = new Error('redis unavailable')

    const resolution = await resolver.resolve('room-a', 1, 'player-a')

    expect(resolution.kind).toBe('ADVANCED')
    expect(scoreRoundSubmission.confirmed).toEqual([])
  })

  const rollThreeTimes = async (): Promise<void> => {
    for (let rollCount = 1; rollCount <= 3; rollCount += 1) {
      await playerRolls.recordRoll('room-a', 'player-a', {
        roundNumber: 1,
        rollCount,
        held: NO_HELD,
      })
    }
  }

  const onlyBroadcast = () => {
    const messages = broadcaster.messagesFor('room-a')
    expect(messages).toHaveLength(1)
    return messages[0] as { type: string; payload: unknown }
  }
})

const SIXES = [6, 6, 6, 6, 6]

interface ConfirmationCommand {
  readonly gameId: string
  readonly playerId: string
  readonly roundNumber: number
  readonly category: string
  readonly dice: readonly number[]
}

/**
 * 2.6 `ScoreRoundSubmissionService`의 대역 — **포트 계약의 실행 가능한 명세**다.
 *
 * 진짜 구현도 이 순서를 지켜야 한다: `RoundSynchronizationService.submit`의
 * `beforeStateChange` 안에서 점수를 확정하고, 확정이 던지면 그 예외가 그대로 올라와
 * 라운드 상태는 무변화로 남는다(제출자가 미제출로 남아 재시도할 수 있다).
 */
class FakeScoreRoundSubmissionService implements ScoreRoundSubmissionPort<RoundSubmissionResult> {
  readonly confirmed: ConfirmationCommand[] = []
  failure: Error | null = null

  constructor(
    private readonly synchronizationService: RoundSynchronizationService,
    private readonly roomService: FakeRoomService,
  ) {}

  async submit(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayload,
  ): Promise<ScoreRoundSubmissionOutcome<RoundSubmissionResult>> {
    const holder: { score: ConfirmedScore | null } = { score: null }
    const round = await this.synchronizationService.submit(roomId, playerId, payload, async () => {
      holder.score = await this.confirm(roomId, playerId, payload)
    })
    return { score: holder.score, round }
  }

  private async confirm(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayload,
  ): Promise<ConfirmedScore> {
    const room = await this.roomService.getSnapshot(roomId)
    const gameId = room?.gameId ?? null
    if (gameId === null) throw new Error('GAME_NOT_FOUND')
    this.confirmed.push({
      gameId,
      playerId,
      roundNumber: payload.roundNumber,
      category: payload.category,
      dice: [...payload.dice],
    })
    if (this.failure !== null) throw this.failure
    return { playerId, scoreboard: { categories: { [payload.category]: 50 }, total: 50 } }
  }
}
