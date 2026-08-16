import { describe, expect, it } from 'vitest'
import { isRoundSyncError, type RoundSyncReason } from '../roundErrors.js'
import { RoundState } from '../roundState.js'
import { RoundSubmission } from '../roundSubmission.js'

/** backend-java `RoundStateTest`의 이식. 케이스 이름·의도를 그대로 옮겼다. */
describe('RoundState', () => {
  it('모든 참가자가 제출할 때까지 라운드를 끝내지 않는다', () => {
    const state = rolled(RoundState.start(1, ['player-a', 'player-b']))

    const result = state.submit(submission('player-a', 1))

    expect(result.completedRound).toBeNull()
    expect(result.state.roundNumber).toBe(1)
    expect(result.state.submittedPlayerIds).toEqual(['player-a'])
    expect(result.state.activePlayerId).toBe('player-b')
  })

  it('전원이 제출하면 라운드를 넘기고 제출 기록을 비운다', () => {
    const state = rolled(RoundState.start(3, ['player-a', 'player-b']))
    const waiting = rolled(state.submit(submission('player-a', 3)).state)

    const result = waiting.submit(submission('player-b', 3))

    expect(result.completedRound).not.toBeNull()
    expect(result.completedRound?.roundNumber).toBe(3)
    expect(result.completedRound?.nextRoundNumber).toBe(4)
    expect(result.completedRound?.submittedPlayerIds).toEqual(['player-a', 'player-b'])
    expect(result.state.roundNumber).toBe(4)
    expect(result.state.submittedPlayerIds).toEqual([])
    expect(result.state.activePlayerId).toBe('player-a')
  })

  it('아직 차례가 오지 않은 플레이어의 제출은 거부한다', () => {
    const waiting = RoundState.start(1, ['player-a', 'player-b'])

    expectReason(() => waiting.submit(submission('player-b', 1)), 'NOT_ACTIVE_PLAYER')
  })

  it('굴림은 정확히 한 번씩 기록되고 다음 플레이어에게서 초기화된다', () => {
    const state = RoundState.start(1, ['player-a', 'player-b'])

    const afterFirstRoll = state.recordRoll('player-a', 1, 1, noHeld(), [1, 2, 3, 4, 5])
    const afterSecondRoll = afterFirstRoll.recordRoll(
      'player-a',
      1,
      2,
      [true, false, true, false, true],
      [6, 6, 6, 6, 6],
    )
    const nextPlayer = afterSecondRoll.submit(
      new RoundSubmission('player-a', 1, afterSecondRoll.activeDice ?? [], 'smallStraight'),
    ).state

    expect(afterFirstRoll.activeRollCount).toBe(1)
    expect(afterSecondRoll.activeRollCount).toBe(2)
    expect(afterSecondRoll.activeDice).toEqual([1, 6, 3, 6, 5])
    expect(nextPlayer.activePlayerId).toBe('player-b')
    expect(nextPlayer.activeRollCount).toBe(0)
  })

  it('자동 굴림은 마지막 KEEP을 유지하고 굴림을 하나 소모한다', () => {
    const afterFirstRoll = RoundState.start(1, ['player-a']).recordRoll(
      'player-a',
      1,
      1,
      noHeld(),
      [6, 6, 6, 2, 1],
    )
    const afterSecondRoll = afterFirstRoll.recordRoll(
      'player-a',
      1,
      2,
      [true, true, true, false, false],
      [1, 1, 1, 5, 5],
    )

    const autoRolled = afterSecondRoll.autoRoll([4, 4, 4, 4, 4])

    expect(afterSecondRoll.activeHeld).toEqual([true, true, true, false, false])
    expect(autoRolled.activeRollCount).toBe(3)
    expect(autoRolled.hasRollsLeft).toBe(false)
    // 킵한 6·6·6은 살아남고 나머지 두 칸만 다시 굴렸다.
    expect(autoRolled.activeDice).toEqual([6, 6, 6, 4, 4])
  })

  it('한 번도 굴리지 않았으면 자동 굴림이 전부를 다시 굴린다', () => {
    const state = RoundState.start(1, ['player-a'])

    const autoRolled = state.autoRoll([3, 3, 3, 3, 3])

    expect(autoRolled.activeRollCount).toBe(1)
    expect(autoRolled.activeDice).toEqual([3, 3, 3, 3, 3])
    expect(autoRolled.activePlayerId).toBe('player-a')
  })

  it('굴림을 다 썼으면 자동 굴림을 거부한다', () => {
    const state = RoundState.start(1, ['player-a'])
      .recordRoll('player-a', 1, 1, noHeld(), [1, 2, 3, 4, 5])
      .recordRoll('player-a', 1, 2, noHeld(), [1, 2, 3, 4, 5])
      .recordRoll('player-a', 1, 3, noHeld(), [1, 2, 3, 4, 5])

    expect(state.hasRollsLeft).toBe(false)
    expectReason(() => state.autoRoll([6, 6, 6, 6, 6]), 'INVALID_ROLL')
  })

  it('건너뛴·중복된 rollCount는 거부한다', () => {
    const state = RoundState.start(1, ['player-a'])

    expectReason(
      () => state.recordRoll('player-a', 1, 2, noHeld(), [1, 2, 3, 4, 5]),
      'INVALID_ROLL',
    )
  })

  it('다른 라운드 번호의 제출은 거부한다', () => {
    const state = RoundState.start(2, ['player-a'])

    expectReason(() => state.submit(submission('player-a', 1)), 'ROUND_MISMATCH')
  })

  it('참가자가 아닌 사람의 제출은 거부한다', () => {
    const state = RoundState.start(1, ['player-a'])

    expectReason(() => state.submit(submission('intruder', 1)), 'PLAYER_NOT_IN_ROUND')
  })

  it('굴리기 전의 제출은 거부한다', () => {
    const state = RoundState.start(1, ['player-a'])

    expectReason(() => state.submit(submission('player-a', 1)), 'INVALID_DICE')
  })

  it('서버 주사위와 다른 주사위 제출은 거부한다', () => {
    const state = RoundState.start(1, ['player-a']).recordRoll(
      'player-a',
      1,
      1,
      noHeld(),
      [1, 2, 3, 4, 6],
    )

    expectReason(
      () => state.submit(new RoundSubmission('player-a', 1, [6, 6, 6, 6, 6], 'yacht')),
      'INVALID_DICE',
    )
  })

  it('중복 참가자는 거부한다', () => {
    expectReason(() => RoundState.start(1, ['player-a', 'player-a']), 'INVALID_PLAYER')
  })

  /**
   * 마지막 라운드의 마지막 제출은 다음 라운드를 만들지 않는다.
   * 여기서 멈추지 않으면 라운드가 13, 14…로 무한히 증가한다(게임이 종료되지 않던 원인).
   */
  it('라운드 상한에 닿으면 다음 라운드 대신 게임 종료로 표시한다', () => {
    const state = rolled(RoundState.start(2, ['player-a'], 2))

    const result = state.submit(submission('player-a', 2))

    expect(result.completedRound?.gameCompleted).toBe(true)
    expect(result.completedRound?.roundNumber).toBe(2)
    expect(result.completedRound?.nextRoundNumber).toBe(2)
    expect(result.state.finished).toBe(true)
    expect(result.state.roundNumber).toBe(2)
  })

  it('마지막 라운드 전까지는 계속 다음 라운드를 연다', () => {
    const state = rolled(RoundState.start(1, ['player-a'], 2))

    const result = state.submit(submission('player-a', 1))

    expect(result.completedRound?.gameCompleted).toBe(false)
    expect(result.state.finished).toBe(false)
    expect(result.state.roundNumber).toBe(2)
  })

  /** 종료 후 도착한 제출·굴림은 거부한다. 받아주면 끝난 게임의 점수판이 다시 바뀐다. */
  it('게임이 끝나면 제출·굴림·만료를 전부 거부한다', () => {
    const finished = RoundState.start(1, ['player-a'], 1)
      .recordRoll('player-a', 1, 1, noHeld(), [1, 2, 3, 4, 5])
      .submit(submission('player-a', 1)).state

    expectReason(() => finished.submit(submission('player-a', 1)), 'GAME_ALREADY_FINISHED')
    expectReason(
      () => finished.recordRoll('player-a', 1, 1, noHeld(), [1, 2, 3, 4, 5]),
      'GAME_ALREADY_FINISHED',
    )
    expectReason(() => finished.expire(), 'GAME_ALREADY_FINISHED')
  })

  /**
   * Java 원본에는 없지만 game-modules.md가 계약으로 못박은 규칙이라 고정한다
   * (`withoutParticipant`: 활성 플레이어는 직접 제거 불가, 인덱스 보정).
   */
  describe('withoutParticipant', () => {
    it('활성 플레이어는 직접 제거할 수 없다 — 먼저 expire로 넘겨야 한다', () => {
      const state = RoundState.start(1, ['player-a', 'player-b'])

      expectReason(() => state.withoutParticipant('player-a'), 'INVALID_PLAYER')
    })

    it('앞 순서를 빼면 활성 인덱스를 당겨 활성 플레이어가 유지된다', () => {
      const state = rolled(RoundState.start(1, ['player-a', 'player-b', 'player-c']))
      const onB = state.submit(submission('player-a', 1)).state

      const removed = onB.withoutParticipant('player-a')

      expect(removed.participantOrder).toEqual(['player-b', 'player-c'])
      expect(removed.activePlayerId).toBe('player-b')
      // 이미 기록된 제출은 지우지 않는다.
      expect(removed.submittedPlayerIds).toEqual(['player-a'])
    })

    it('참가자가 아니거나 이미 끝난 게임이면 그대로 돌려준다', () => {
      const state = RoundState.start(1, ['player-a', 'player-b'])
      expect(state.withoutParticipant('ghost')).toBe(state)

      const finished = RoundState.start(1, ['player-a', 'player-b'], 1)
        .recordRoll('player-a', 1, 1, noHeld(), [1, 2, 3, 4, 5])
        .submit(submission('player-a', 1))
        .state.expire().state
      expect(finished.finished).toBe(true)
      expect(finished.withoutParticipant('player-b')).toBe(finished)
    })
  })

  it('첫 굴림 전에는 KEEP을 기록할 수 없다', () => {
    const state = RoundState.start(1, ['player-a'])

    expectReason(
      () => state.recordHold('player-a', 1, [true, false, false, false, false]),
      'INVALID_ROLL',
    )
    expectReason(
      () => state.recordRoll('player-a', 1, 1, [true, false, false, false, false], [1, 2, 3, 4, 5]),
      'INVALID_ROLL',
    )
  })

  it('recordHold는 KEEP 배열을 통째로 교체한다(델타가 아니다)', () => {
    const rolledState = rolled(RoundState.start(1, ['player-a']))

    const held = rolledState.recordHold('player-a', 1, [true, true, false, false, false])

    expect(held.activeHeld).toEqual([true, true, false, false, false])
    expect(held.activeRollCount).toBe(1)
    expect(held.activeDice).toEqual([1, 2, 3, 4, 5])
  })
})

const submission = (playerId: string, roundNumber: number): RoundSubmission =>
  new RoundSubmission(playerId, roundNumber, [1, 2, 3, 4, 5], 'smallStraight')

const noHeld = (): boolean[] => [false, false, false, false, false]

const rolled = (state: RoundState): RoundState =>
  state.recordRoll(state.activePlayerId, state.roundNumber, 1, noHeld(), [1, 2, 3, 4, 5])

const expectReason = (action: () => unknown, reason: RoundSyncReason): void => {
  try {
    action()
  } catch (error) {
    expect(isRoundSyncError(error, reason)).toBe(true)
    return
  }
  expect.unreachable(`expected ${reason}`)
}
