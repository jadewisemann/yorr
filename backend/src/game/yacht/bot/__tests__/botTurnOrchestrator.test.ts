import { beforeEach, describe, expect, it } from 'vitest'
import { type RoundStartedEvent, RoundState } from '../../../round/index.js'
import { createScoreBoard } from '../../../score/index.js'
import { RecordingBroadcaster } from '../../__tests__/testDoubles.js'
import {
  BotTurnOrchestrator,
  HOLD_SELECTION_DELAY_MS,
  ROLL_RESULT_DELAY_MS,
  THROW_DELAY_MS,
  TURN_START_DELAY_MS,
} from '../botTurnOrchestrator.js'
import { ExpectimaxYachtBotPolicy } from '../expectimaxYachtBotPolicy.js'
import { LocalYachtBotStrategy } from '../localYachtBotStrategy.js'
import { ScorecardValueEvaluator } from '../scorecardValueEvaluator.js'
import { YachtBotTurnCoordinator } from '../yachtBotTurnCoordinator.js'
import {
  FakeBotRooms,
  FakeBotRounds,
  FakeBotScores,
  ManualExecutor,
  RecordingBotActions,
  roomWith,
} from './botTestDoubles.js'

/**
 * `BotTurnOrchestratorTest` 이식(3종) + 지연 4종·오류 격리 검증.
 *
 * Java는 `mock(ScheduledExecutorService)` + `ArgumentCaptor<Runnable>`로 예약을 잡고
 * 손으로 `run()` 한다. 여기서는 같은 일을 `ManualExecutor`가 한다 — **실시간
 * sleep도 가짜 타이머도 쓰지 않는다**(6.5초를 기다리는 테스트는 만들지 않는다).
 */

const NO_HELD = [false, false, false, false, false]
const ROOM = 'room-a'

describe('BotTurnOrchestrator', () => {
  let executor: ManualExecutor
  let broadcaster: RecordingBroadcaster
  let rounds: FakeBotRounds
  let actions: RecordingBotActions
  let rooms: FakeBotRooms
  let scores: FakeBotScores

  const coordinatorFor = (): YachtBotTurnCoordinator =>
    new YachtBotTurnCoordinator({
      rounds,
      actions,
      policy: new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator()),
      strategy: new LocalYachtBotStrategy(),
      rooms,
      scores,
    })

  beforeEach(() => {
    executor = new ManualExecutor()
    broadcaster = new RecordingBroadcaster()
    rounds = new FakeBotRounds()
    actions = new RecordingBotActions()
    rooms = new FakeBotRooms(roomWith('game-a', [{ playerId: 'bot-a', kind: 'BOT' }]))
    scores = new FakeBotScores()
    scores.board = createScoreBoard({}, 0, 0, 0)
  })

  it('방 하나에서 마지막으로 예약된 상태만 실행한다', async () => {
    // 세대 가드. 지연이 6.5초씩 되므로 그 사이에 턴이 넘어가는 일이 실제로 생긴다.
    const executed: number[] = []
    const orchestrator = new BotTurnOrchestrator(
      {
        coordinator: {
          executeIfCurrent: async (event: RoundStartedEvent) => {
            executed.push(event.state.roundNumber)
            return { acted: false, continueAfterObservation: false, state: null }
          },
        } as unknown as YachtBotTurnCoordinator,
        broadcaster,
      },
      { executor },
    )
    const first = { roomId: ROOM, state: RoundState.start(1, ['bot-a', 'player-a']) }
    const latest = { roomId: ROOM, state: RoundState.start(2, ['bot-a', 'player-a']) }

    orchestrator.onRoundStarted(first)
    orchestrator.onRoundStarted(latest)

    expect(executor.tasks).toHaveLength(2)
    await executor.fire(0)
    expect(executed).toEqual([])
    await executor.fire(1)
    expect(executed).toEqual([2])
  })

  it('킵 선택 뒤 같은 턴을 이어가기 전에 기다린다', async () => {
    const state = RoundState.start(1, ['bot-a', 'player-a'])
    const held = state
      .recordRoll('bot-a', 1, 1, NO_HELD, [6, 6, 2, 3, 4])
      .recordHold('bot-a', 1, [true, true, false, false, false])
    const orchestrator = new BotTurnOrchestrator(
      {
        coordinator: {
          executeIfCurrent: async () => ({
            acted: true,
            continueAfterObservation: true,
            state: held,
          }),
        } as unknown as YachtBotTurnCoordinator,
        broadcaster,
      },
      { executor },
    )

    orchestrator.onRoundStarted({ roomId: ROOM, state })

    expect(executor.delays()).toEqual([TURN_START_DELAY_MS])
    await executor.fire(0)
    // 킵 선택 지연으로 같은 턴이 다시 예약된다. 중간의 600ms는 이 픽스처의 상태가
    // rollCount 0 → 1이라 `isRollStep`도 성립하기 때문이다(Java 테스트도 같은
    // 픽스처이고, `eq(0L)` 매처가 그 예약을 세지 않아 안 보였을 뿐이다).
    expect(executor.delays()).toEqual([
      TURN_START_DELAY_MS,
      THROW_DELAY_MS,
      HOLD_SELECTION_DELAY_MS,
    ])
  })

  it('봇 굴림 뒤 dice.thrown을 알려 원격 주사위를 놓게 한다', async () => {
    const state = RoundState.start(1, ['bot-a', 'player-a'])
    const rolled = state.recordRoll('bot-a', 1, 1, NO_HELD, [6, 6, 2, 3, 4])
    const orchestrator = new BotTurnOrchestrator(
      {
        coordinator: {
          executeIfCurrent: async () => ({
            acted: true,
            continueAfterObservation: false,
            state: rolled,
          }),
        } as unknown as YachtBotTurnCoordinator,
        broadcaster,
      },
      { executor, now: () => 1_700_000_000_000 },
    )

    orchestrator.onRoundStarted({ roomId: ROOM, state })
    await executor.fire(0)

    expect(executor.tasks[1]?.delayMs).toBe(THROW_DELAY_MS)
    await executor.fire(1)

    const thrown = broadcaster.lastOf(ROOM, 'game.yacht_dice.dice.thrown')
    expect(thrown.payload).toEqual({ playerId: 'bot-a', roundNumber: 1, rollCount: 1 })
    // 봇 경로는 msgId를 에코하지 않는다(사람 ✓ / 봇 ✗ — yacht.md의 아웃바운드 표).
    expect(thrown.msgId).toBeUndefined()
    // 봇은 dice.shaken을 내지 않는다 — 이 오케스트레이터가 내는 것은 thrown 하나다.
    expect(broadcaster.typesFor(ROOM)).toEqual(['game.yacht_dice.dice.thrown'])
  })

  it('굴림 관찰 지연은 턴 시작 지연과 다르다', () => {
    const state = RoundState.start(1, ['bot-a', 'player-a'])
    const afterRoll = state.recordRoll('bot-a', 1, 1, NO_HELD, [6, 6, 2, 3, 4])
    const orchestrator = new BotTurnOrchestrator(
      { coordinator: coordinatorFor(), broadcaster },
      { executor },
    )

    orchestrator.onRoundStarted({ roomId: ROOM, state })
    orchestrator.onRoundStarted({ roomId: ROOM, state: afterRoll })

    // rollCount 0 → 턴 시작 1200ms, rollCount 1 → 굴림 관찰 6500ms.
    expect(executor.delays()).toEqual([TURN_START_DELAY_MS, ROLL_RESULT_DELAY_MS])
  })

  it('실제 굴림이면 dice.thrown 예약이 자기 세대가 아니라 최신 세대로 걸린다', async () => {
    // 굴림은 안에서 timers.start → onRoundStarted를 다시 부른다 = 세대가 올라간다.
    // 자기 세대로 예약하면 thrown이 항상 스테일로 버려지는데, 그 회귀를 잡는다.
    const state = RoundState.start(1, ['bot-a', 'player-a'])
    const rolled = state.recordRoll('bot-a', 1, 1, NO_HELD, [6, 6, 2, 3, 4])
    let orchestrator: BotTurnOrchestrator | null = null
    orchestrator = new BotTurnOrchestrator(
      {
        coordinator: {
          executeIfCurrent: async () => {
            // 굴림이 유발하는 재진입을 그대로 재현한다.
            orchestrator?.onRoundStarted({ roomId: ROOM, state: rolled })
            return { acted: true, continueAfterObservation: false, state: rolled }
          },
        } as unknown as YachtBotTurnCoordinator,
        broadcaster,
      },
      { executor },
    )

    orchestrator.onRoundStarted({ roomId: ROOM, state })
    await executor.fire(0)

    // 예약: [0]=턴 시작, [1]=재진입한 굴림 관찰, [2]=thrown
    const throwTask = executor.tasks.findIndex((task) => task.delayMs === THROW_DELAY_MS)
    expect(throwTask).toBeGreaterThan(0)
    await executor.fire(throwTask)

    expect(broadcaster.typesFor(ROOM)).toEqual(['game.yacht_dice.dice.thrown'])
  })

  it('봇 스텝의 예외를 삼키고 관측 훅으로만 흘린다', async () => {
    // 라운드 타이머(25s+1s)가 폴백이라 여기서 던지면 방 전체가 아니라 봇만 조용히 멈춰야 한다.
    const errors: unknown[] = []
    const orchestrator = new BotTurnOrchestrator(
      {
        coordinator: {
          executeIfCurrent: async () => {
            throw new Error('redis unavailable')
          },
        } as unknown as YachtBotTurnCoordinator,
        broadcaster,
      },
      { executor, onError: (error) => errors.push(error) },
    )

    orchestrator.onRoundStarted({ roomId: ROOM, state: RoundState.start(1, ['bot-a']) })
    await expect(executor.fire(0)).resolves.toBeUndefined()

    expect(errors).toHaveLength(1)
    expect(broadcaster.sent).toHaveLength(0)
  })

  it('stop()이 남은 예약을 취소한다', () => {
    const orchestrator = new BotTurnOrchestrator(
      { coordinator: coordinatorFor(), broadcaster },
      { executor },
    )
    orchestrator.onRoundStarted({ roomId: ROOM, state: RoundState.start(1, ['bot-a']) })

    orchestrator.stop()

    expect(executor.tasks[0]?.cancelled).toBe(true)
  })
})
