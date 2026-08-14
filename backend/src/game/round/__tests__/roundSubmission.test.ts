import { describe, expect, it } from 'vitest'
import { isRoundSyncError, type RoundSyncReason } from '../roundErrors.js'
import { RoundSubmission } from '../roundSubmission.js'

/** backend-java `RoundSubmissionTest`의 이식. */
describe('RoundSubmission', () => {
  it('주사위를 방어적으로 복사한다', () => {
    const dice = [1, 2, 3, 4, 5]

    const submission = new RoundSubmission('player-a', 1, dice, 'choice')
    dice[0] = 6

    expect(submission.dice).toEqual([1, 2, 3, 4, 5])
    // Java의 List.copyOf → UnsupportedOperationException 자리. 얼린 배열은 TypeError.
    expect(() => (submission.dice as number[]).push(6)).toThrow(TypeError)
  })

  it('잘못된 주사위는 거부한다', () => {
    expectReason(
      () => new RoundSubmission('player-a', 1, [1, 2, 3, 4, 7], 'choice'),
      'INVALID_DICE',
    )
    expectReason(() => new RoundSubmission('player-a', 1, [1, 2, 3, 4], 'choice'), 'INVALID_DICE')
  })

  it('모르는 카테고리는 거부한다', () => {
    expectReason(
      () => new RoundSubmission('player-a', 1, [1, 2, 3, 4, 5], 'unknown'),
      'INVALID_CATEGORY',
    )
  })

  it('빈 playerId·0 이하 라운드도 생성 지점에서 막는다', () => {
    expectReason(() => new RoundSubmission('  ', 1, [1, 2, 3, 4, 5], 'choice'), 'INVALID_PLAYER')
    expectReason(
      () => new RoundSubmission('player-a', 0, [1, 2, 3, 4, 5], 'choice'),
      'INVALID_ROUND',
    )
  })
})

const expectReason = (action: () => unknown, reason: RoundSyncReason): void => {
  try {
    action()
  } catch (error) {
    expect(isRoundSyncError(error, reason)).toBe(true)
    return
  }
  expect.unreachable(`expected ${reason}`)
}
