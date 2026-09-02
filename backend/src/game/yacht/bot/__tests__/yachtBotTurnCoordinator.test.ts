import { beforeEach, describe, expect, it } from 'vitest'
import { RoundState } from '../../../round/index.js'
import { createScoreBoard } from '../../../score/index.js'
import type { YachtBotPolicy } from '../botPorts.js'
import { ExpectimaxYachtBotPolicy, holdDecision } from '../expectimaxYachtBotPolicy.js'
import { LocalYachtBotStrategy } from '../localYachtBotStrategy.js'
import { ScorecardValueEvaluator } from '../scorecardValueEvaluator.js'
import { YachtBotTurnCoordinator } from '../yachtBotTurnCoordinator.js'
import {
  FakeBotRooms,
  FakeBotRounds,
  FakeBotScores,
  RecordingBotActions,
  roomWith,
} from './botTestDoubles.js'

/**
 * `YachtBotTurnCoordinatorTest` 이식(9종) + 스테일 경계 2종.
 *
 * 대역이 실제
 * `RoundState`를 돌려준다. `BotTurnStep.state`가 오케스트레이터의 `dice.thrown`
 * 판정 입력이라, null로 두면 그 계약이 테스트에서 사라진다.
 */

const NO_HELD = [false, false, false, false, false]
const ROOM = 'room-a'
const GAME = 'game-a'

/** 지정한 주사위로 굴림을 기록한 상태(서버 RNG 자리를 테스트가 고정한다). */
const rolled = (
  state: RoundState,
  playerId: string,
  rollCount: number,
  held: readonly boolean[],
  dice: readonly number[],
): RoundState => state.recordRoll(playerId, state.roundNumber, rollCount, held, dice)

/** 봇이 선인 1라운드에서 첫 굴림까지 마친 상태. */
const botTurnRolled = (dice: readonly number[]): RoundState =>
  rolled(RoundState.start(1, ['bot-a', 'player-a']), 'bot-a', 1, NO_HELD, dice)

/** 위와 같되 5 한 짝을 **두 번째 자리에** 이미 잡아 둔 상태 — 자리 유지 규칙을 보는 판이다. */
const botTurnWithHeldPair = (): RoundState =>
  botTurnRolled([5, 5, 2, 3, 4]).recordHold('bot-a', 1, [false, true, false, false, false])

describe('YachtBotTurnCoordinator', () => {
  let rounds: FakeBotRounds
  let actions: RecordingBotActions
  let rooms: FakeBotRooms
  let scores: FakeBotScores
  let coordinator: YachtBotTurnCoordinator

  const build = (policy?: YachtBotPolicy): YachtBotTurnCoordinator =>
    new YachtBotTurnCoordinator({
      rounds,
      actions,
      policy: policy ?? new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator()),
      strategy: new LocalYachtBotStrategy(),
      rooms,
      scores,
    })

  beforeEach(() => {
    rounds = new FakeBotRounds()
    actions = new RecordingBotActions()
    rooms = new FakeBotRooms(
      roomWith(GAME, [
        { playerId: 'player-a', kind: 'HUMAN' },
        { playerId: 'bot-a', kind: 'BOT' },
      ]),
    )
    scores = new FakeBotScores()
    scores.board = createScoreBoard({}, 0, 0, 0)
    coordinator = build()
  })

  it('현재 봇의 턴을 서버 생성 굴림으로 시작한다', async () => {
    const state = RoundState.start(1, ['bot-a', 'player-a'])
    rounds.current = state
    actions.rollResult = rolled(state, 'bot-a', 1, NO_HELD, [1, 2, 3, 4, 5])

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(true)

    expect(actions.rolls).toHaveLength(1)
    expect(actions.rolls[0]?.payload).toEqual({ roundNumber: 1, rollCount: 1, held: NO_HELD })
    // 봇은 msgId를 넘기지 않는다 = 응답 봉투에 msgId가 없다 = 프론트가 "내 굴림"으로
    // 오인하지 않는다.
    expect(actions.rolls[0]?.msgId).toBeNull()
  })

  it('예약 뒤에 라운드 상태가 바뀌었으면 행동을 버린다', async () => {
    const scheduled = RoundState.start(1, ['bot-a', 'player-a'])
    rounds.current = rolled(scheduled, 'bot-a', 1, NO_HELD, [1, 2, 3, 4, 5])

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state: scheduled })).toBe(false)

    expect(actions.rolls).toHaveLength(0)
    expect(actions.holds).toHaveLength(0)
    expect(actions.submits).toHaveLength(0)
  })

  it('킵만 바뀌어도 스테일이다 — TurnVersion은 held까지 본다', async () => {
    const scheduled = rolled(
      RoundState.start(1, ['bot-a', 'player-a']),
      'bot-a',
      1,
      NO_HELD,
      [6, 6, 2, 3, 4],
    )
    rounds.current = scheduled.recordHold('bot-a', 1, [true, false, false, false, false])

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state: scheduled })).toBe(false)
    expect(actions.holds).toHaveLength(0)
  })

  it('3굴림 뒤 최선의 열린 카테고리를 제출한다', async () => {
    let state = RoundState.start(1, ['bot-a', 'player-a'])
    state = rolled(state, 'bot-a', 1, NO_HELD, [6, 6, 6, 6, 6])
    state = rolled(state, 'bot-a', 2, NO_HELD, [6, 6, 6, 6, 6])
    state = rolled(state, 'bot-a', 3, NO_HELD, [6, 6, 6, 6, 6])
    rounds.current = state
    scores.open = ['sixes', 'yacht']

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(true)

    expect(actions.submits).toHaveLength(1)
    expect(actions.submits[0]?.payload.category).toBe('yacht')
    expect(actions.submits[0]?.payload.dice).toEqual([6, 6, 6, 6, 6])
    expect(actions.submits[0]?.msgId).toBeNull()
  })

  it('이미 완성된 야추는 의미 없는 리롤 없이 제출한다', async () => {
    const state = rolled(
      RoundState.start(1, ['bot-a', 'player-a']),
      'bot-a',
      1,
      NO_HELD,
      [6, 6, 6, 6, 6],
    )
    rounds.current = state

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(true)

    expect(actions.submits[0]?.payload.category).toBe('yacht')
    expect(actions.rolls).toHaveLength(0)
  })

  it('다음 굴림 전에 킵 선택을 먼저 노출한다', async () => {
    const state = botTurnRolled([6, 6, 2, 3, 4])
    rounds.current = state
    actions.holdResult = state.recordHold('bot-a', 1, [true, true, false, false, false])

    const step = await coordinator.executeIfCurrent({ roomId: ROOM, state })

    expect(step.acted).toBe(true)
    // hold를 낸 뒤 **관찰 지연을 두고** 같은 턴으로 되돌아온다.
    expect(step.continueAfterObservation).toBe(true)
    expect(actions.holds).toHaveLength(1)
    expect(actions.rolls).toHaveLength(0)
  })

  it('이미 킵된 중복 면을 재사용하고 hold 이벤트를 내지 않는다', async () => {
    // 정책은 "5를 한 개 남긴다"고만 말한다 — 앞자리(index 0)를 지목했지만 실제로
    // 잡혀 있는 것은 index 1이다. 자리를 옮기면 hold_changed가 한 번 더 나가므로
    // 코디네이터가 이미 잡힌 자리를 유지해야 한다.
    const state = botTurnWithHeldPair()
    rounds.current = state
    actions.rollResult = state
    coordinator = build({
      decide: () => holdDecision([true, false, false, false, false], 0),
    })

    const step = await coordinator.executeIfCurrent({ roomId: ROOM, state })

    expect(step.acted).toBe(true)
    expect(step.continueAfterObservation).toBe(false)
    expect(actions.holds).toHaveLength(0)
    expect(actions.rolls).toHaveLength(1)
    expect(actions.rolls[0]?.payload.held).toEqual([false, true, false, false, false])
    // rollCount는 저장소에서 다시 읽은 값 + 1이다.
    expect(actions.rolls[0]?.payload.rollCount).toBe(2)
  })

  it('이미 킵된 주사위를 풀지 않고 중복을 하나 더 잡는다', async () => {
    const state = botTurnWithHeldPair()
    rounds.current = state
    actions.holdResult = state
    coordinator = build({
      decide: () => holdDecision([true, true, false, false, false], 0),
    })

    const step = await coordinator.executeIfCurrent({ roomId: ROOM, state })

    expect(step.continueAfterObservation).toBe(true)
    expect(actions.holds).toHaveLength(1)
    expect(actions.holds[0]?.payload.held).toEqual([true, true, false, false, false])
    expect(actions.rolls).toHaveLength(0)
  })

  it('사람의 턴은 무시한다', async () => {
    const state = RoundState.start(1, ['player-a', 'bot-a'])
    rounds.current = state

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(false)
    expect(actions.rolls).toHaveLength(0)
  })

  it('게임이 시작되지 않은 방(gameId 없음)은 무시한다', async () => {
    const state = RoundState.start(1, ['bot-a', 'player-a'])
    rounds.current = state
    rooms.set(roomWith(null, [{ playerId: 'bot-a', kind: 'BOT' }]))

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(false)
    expect(actions.rolls).toHaveLength(0)
  })

  it('Expectimax가 실패하면 폴백 정책으로 계속한다', async () => {
    const state = botTurnRolled([6, 6, 2, 3, 4])
    rounds.current = state
    actions.holdResult = state
    const fallbacks: unknown[] = []
    coordinator = new YachtBotTurnCoordinator(
      {
        rounds,
        actions,
        policy: {
          decide: () => {
            throw new Error('search_failed')
          },
        },
        strategy: new LocalYachtBotStrategy(),
        rooms,
        scores,
      },
      { onPolicyFallback: (_roomId, _state, error) => fallbacks.push(error) },
    )

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(true)

    expect(actions.holds).toHaveLength(1)
    expect(fallbacks).toHaveLength(1)
  })

  it('폴백이 전체 킵을 말하면 리롤이 아니라 제출로 해석한다', async () => {
    // 6이 다섯 개면 폴백의 chooseHeld가 전부 true를 준다 → 제출.
    let state = rolled(
      RoundState.start(1, ['bot-a', 'player-a']),
      'bot-a',
      1,
      NO_HELD,
      [6, 6, 6, 6, 6],
    )
    state = rolled(state, 'bot-a', 2, NO_HELD, [6, 6, 6, 6, 6])
    rounds.current = state
    coordinator = build({
      decide: () => {
        throw new Error('search_failed')
      },
    })

    expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(true)

    expect(actions.submits).toHaveLength(1)
    expect(actions.submits[0]?.payload.category).toBe('yacht')
    expect(actions.rolls).toHaveLength(0)
  })

  it('킵 재사용 경로에서 굴림 직전에 턴이 넘어가면 아무것도 하지 않는다', async () => {
    const state = botTurnWithHeldPair()
    // 1회차 = TurnVersion 확인, 2회차 = 굴림 직전 재확인. 두 번째에 사람이 제출해
    // 턴이 넘어간 상태를 준다.
    const advanced = state.submit({
      playerId: 'bot-a',
      roundNumber: 1,
      dice: [5, 5, 2, 3, 4],
      category: 'choice',
    }).state
    rounds.queue(state, advanced)
    coordinator = build({
      decide: () => holdDecision([false, true, false, false, false], 0),
    })

    const step = await coordinator.executeIfCurrent({ roomId: ROOM, state })

    expect(step.acted).toBe(false)
    expect(actions.rolls).toHaveLength(0)
    expect(actions.holds).toHaveLength(0)
  })
})
