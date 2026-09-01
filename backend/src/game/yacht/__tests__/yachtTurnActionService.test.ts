import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryRoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  seededDieRoller,
} from '../../round/index.js'
import { ScoreConfirmationService, ScoreRoundSubmissionService } from '../../score/index.js'
import { YachtTurnActionService } from '../yachtTurnActionService.js'
import {
  FakeRoundTimer,
  FakeScoreBoardStore,
  NO_HELD,
  RecordingBroadcaster,
} from './testDoubles.js'

/**
 * `RoundTimerService`·`RoomBroadcaster`·`ScoreRoundSubmissionService` 셋을
 * 모킹하고 라운드 서비스만 진짜를 썼다. 여기서는 **제출 경로도 진짜**를 쓴다
 * (`ScoreRoundSubmissionService` + `ScoreConfirmationService` + 대역 저장소) —
 * 그 경로의 계약 절반이 "라운드 검증 → 점수 확정 → 커밋" 순서라, 모킹하면 테스트가
 * 그 순서를 스스로 정의해 버린다(1.6에서 같은 판단을 했다).
 */
describe('YachtTurnActionService', () => {
  const ROOM = 'room-a'
  let rounds: RoundSynchronizationService
  let timers: FakeRoundTimer
  let broadcaster: RecordingBroadcaster
  let scoreBoards: FakeScoreBoardStore
  let actions: YachtTurnActionService
  let ts: number

  beforeEach(async () => {
    rounds = new RoundSynchronizationService(new InMemoryRoundStateStore(), {
      dieRoller: seededDieRoller(20260814),
    })
    timers = new FakeRoundTimer()
    broadcaster = new RecordingBroadcaster()
    scoreBoards = new FakeScoreBoardStore()
    ts = 1_700_000_000_000
    const submissions = new ScoreRoundSubmissionService<RoundSubmissionResult>(
      rounds,
      new ScoreConfirmationService(scoreBoards),
      { getSnapshot: async () => ({ gameId: 'game-a' }) },
    )
    actions = new YachtTurnActionService(
      { rounds, timers, broadcaster, submissions },
      { now: () => ts },
    )
    await rounds.initialize(ROOM, 1, ['player-a', 'player-b'])
  })

  const roll = async (msgId: string | null = 'roll-a', rollCount = 1, held = NO_HELD) =>
    actions.roll(ROOM, 'player-a', { roundNumber: 1, rollCount, held }, msgId)

  it('상태를 바꾸고 결과를 방송하고 타이머를 다시 건다', async () => {
    const state = await roll()

    expect(state.activeRollCount).toBe(1)
    expect(state.activeDice).toHaveLength(5)
    expect(state.activeDice?.every((die) => die >= 1 && die <= 6)).toBe(true)
    // 굴림마다 타이머를 다시 건다 = round.start 재전송(마감 연장).
    expect(timers.started).toEqual([{ roomId: ROOM, state }])

    const envelope = broadcaster.lastOf(ROOM, 'game.yacht_dice.dice.broadcast')
    expect(envelope.roomId).toBe(ROOM)
    expect(envelope.msgId).toBe('roll-a')
    expect(envelope.ts).toBe(ts)
    expect(envelope.payload).toEqual({
      playerId: 'player-a',
      roundNumber: 1,
      rollCount: 1,
      dice: state.activeDice,
      held: [false, false, false, false, false],
      auto: false,
    })
  })

  it('주사위는 서버가 만든다 — payload에 눈이 없어도 5개가 생성된다', async () => {
    const state = await roll()
    const broadcast = broadcaster.lastOf(ROOM, 'game.yacht_dice.dice.broadcast').payload as {
      dice: number[]
    }

    expect(broadcast.dice).toEqual([...(state.activeDice ?? [])])
  })

  it('dice.broadcast의 held는 클라이언트가 보낸 값의 에코다 — 서버 activeHeld가 아니다', async () => {
    await roll('roll-1')
    // 두 번째 굴림: 클라이언트가 첫 두 개를 킵했다고 보냈다.
    const clientHeld = [true, true, false, false, false]
    const state = await actions.roll(
      ROOM,
      'player-a',
      { roundNumber: 1, rollCount: 2, held: clientHeld },
      'roll-2',
    )

    const payload = broadcaster.lastOf(ROOM, 'game.yacht_dice.dice.broadcast').payload as {
      held: boolean[]
    }
    expect(payload.held).toEqual(clientHeld)
    expect(state.activeHeld).toEqual(clientHeld)
    // 에코라는 사실은 "같은 배열 객체가 아니라 복사본"이라는 점에서도 확인된다.
    expect(payload.held).not.toBe(clientHeld)
  })

  it('hold는 상태를 바꾸고 방송하지만 타이머를 다시 걸지 않는다', async () => {
    await roll()
    timers.reset()
    broadcaster.reset()

    const state = await actions.hold(
      ROOM,
      'player-a',
      { roundNumber: 1, held: [true, true, false, false, false] },
      'hold-a',
    )

    expect(state.activeHeld).toEqual([true, true, false, false, false])
    const envelope = broadcaster.lastOf(ROOM, 'game.yacht_dice.dice.hold_changed')
    expect(envelope.msgId).toBe('hold-a')
    expect(envelope.payload).toEqual({
      playerId: 'player-a',
      roundNumber: 1,
      held: [true, true, false, false, false],
    })
    // KEEP 토글로 턴을 무한히 늘릴 수 없어야 한다.
    expect(timers.started).toHaveLength(0)
  })

  it('submitScore는 공유 제출·턴 진행 경로를 그대로 탄다', async () => {
    const state = await roll()
    const payload = {
      roundNumber: 1,
      dice: [...(state.activeDice ?? [])],
      category: 'choice',
    }

    const result = await actions.submitScore(ROOM, 'player-a', payload, 'submit-a')

    expect(result.score?.playerId).toBe('player-a')
    expect(result.round.completedRound).toBeNull()
    expect(result.round.state.activePlayerId).toBe('player-b')
    expect(timers.advanced).toEqual([{ roomId: ROOM, result, msgId: 'submit-a' }])
    // 점수는 서버가 재계산한다 — 클라이언트 점수는 와이어에 존재하지 않는다.
    expect(scoreBoards.confirmed).toHaveLength(1)
    expect(scoreBoards.confirmed[0]?.category).toBe('choice')
  })

  it('점수 저장이 실패하면 라운드 상태는 무변화이고 턴도 진행되지 않는다', async () => {
    const state = await roll()
    scoreBoards.failWith('STORE_FAILURE')

    await expect(
      actions.submitScore(
        ROOM,
        'player-a',
        { roundNumber: 1, dice: [...(state.activeDice ?? [])], category: 'choice' },
        'submit-a',
      ),
    ).rejects.toThrow(/redis unavailable/)

    const current = await rounds.findByRoomId(ROOM)
    expect(current?.roundNumber).toBe(1)
    expect(current?.activePlayerId).toBe('player-a')
    expect(current?.submittedPlayerIds).toEqual([])
    expect(timers.advanced).toHaveLength(0)
  })

  it('msgId가 없으면 봉투에서 필드가 사라진다', async () => {
    await roll(null)

    const envelope = broadcaster.lastOf(ROOM, 'game.yacht_dice.dice.broadcast')
    expect(envelope.msgId).toBeUndefined()
    expect(JSON.parse(JSON.stringify(envelope))).not.toHaveProperty('msgId')
  })
})
