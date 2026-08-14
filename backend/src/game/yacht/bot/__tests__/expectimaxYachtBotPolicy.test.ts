import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { createScoreBoard, SCORE_CATEGORIES, type ScoreBoard } from '../../../score/index.js'
import { BotSearchBudgetError } from '../botErrors.js'
import { ExpectimaxYachtBotPolicy } from '../expectimaxYachtBotPolicy.js'
import { ScorecardValueEvaluator } from '../scorecardValueEvaluator.js'

/**
 * `ExpectimaxYachtBotPolicyTest` 이식(11종) + 예산 강제 2종.
 *
 * 여기 단정된 킵·카테고리는 **정확 확률 계산의 결과**라 결정론적이다. 하나라도
 * 달라지면 확률표·메모 키·타이브레이크 중 하나가 틀어진 것이다.
 */

const emptyBoard = (): ScoreBoard => createScoreBoard({}, 0, 0, 0)

const boardWith = (filled: Readonly<Record<string, number>>, upperSubtotal: number): ScoreBoard => {
  const total = Object.values(filled).reduce((sum, score) => sum + score, 0)
  return createScoreBoard(filled, upperSubtotal, 0, total)
}

describe('ExpectimaxYachtBotPolicy', () => {
  const policy = new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator())

  it('야추 기대값을 위해 같은 고면 4개를 남긴다', () => {
    const decision = policy.decide(emptyBoard(), [6, 6, 1, 6, 6], 1)

    expect(decision.action).toBe('HOLD')
    expect(decision.held).toEqual([true, true, false, true, true])
  })

  it('트레이·식스가 모두 열려 있으면 높은 페어를 고른다', () => {
    for (const kicker of [1, 2, 4, 5]) {
      const decision = policy.decide(emptyBoard(), [3, 3, 6, 6, kicker], 1)

      expect(decision.action).toBe('HOLD')
      expect(decision.held.slice(0, 4), `kicker=${kicker}`).toEqual([false, false, true, true])
    }
  })

  it('상단 보너스를 확보할 수 있으면 열린 상단 페어를 고를 수 있다', () => {
    const board = boardWith({ ones: 3, twos: 6, fours: 16, fives: 35, sixes: 0 }, 60)

    const decision = policy.decide(board, [3, 3, 6, 6, 1], 1)

    // 식스가 이미 0으로 닫혀 있어 6을 모아도 소용없다 — 남은 상단(트레이)로 63을 노린다.
    expect(decision.action).toBe('HOLD')
    expect(decision.held).toEqual([true, true, false, false, false])
  })

  it('낙관적인 미래 식스 턴보다 확실한 고면 페어를 고른다', () => {
    const board = boardWith(
      {
        ones: 1,
        twos: 4,
        fours: 16,
        fives: 5,
        choice: 18,
        fourOfAKind: 0,
        fullHouse: 22,
        smallStraight: 15,
        largeStraight: 30,
        yacht: 0,
      },
      26,
    )

    const decision = policy.decide(board, [3, 3, 6, 6, 1], 1)

    expect(decision.action).toBe('HOLD')
    expect(decision.held).toEqual([false, false, true, true, false])
  })

  it('라지 스트레이트 가능성을 위해 단독 4연속을 남긴다', () => {
    const decision = policy.decide(emptyBoard(), [2, 3, 4, 5, 5], 1)

    expect(decision.action).toBe('HOLD')
    expect(decision.held).toEqual([true, true, true, true, false])
  })

  it('마지막 라지 스트레이트 시도를 위해 완성된 스몰을 유지한다', () => {
    const decision = policy.decide(emptyBoard(), [2, 3, 4, 5, 5], 2)

    expect(decision.action).toBe('HOLD')
    expect(decision.held).toEqual([true, true, true, true, false])
  })

  it('마지막 굴림 뒤에는 초이스가 아니라 지켜낸 스몰을 기록한다', () => {
    const decision = policy.decide(emptyBoard(), [3, 3, 4, 5, 6], 3)

    expect(decision.action).toBe('SCORE')
    expect(decision.category).toBe('smallStraight')
  })

  it('3굴림 뒤에는 최선의 카테고리를 제출한다', () => {
    const decision = policy.decide(emptyBoard(), [6, 6, 6, 6, 6], 3)

    expect(decision.action).toBe('SCORE')
    expect(decision.category).toBe('yacht')
  })

  it('식스 5개가 유일한 보너스 기회면 야추 대신 식스를 쓴다', () => {
    const board = boardWith({ ones: 3, twos: 6, threes: 9, fours: 0, fives: 15 }, 33)

    const decision = policy.decide(board, [6, 6, 6, 6, 6], 3)

    expect(decision.category).toBe('sixes')
  })

  it('마지막 보너스 기회를 지키려 야추에 0을 적는다', () => {
    const filled: Record<string, number> = {}
    for (const category of SCORE_CATEGORIES) {
      if (category === 'sixes' || category === 'yacht') continue
      filled[category] = category === 'ones' || category === 'twos' ? 12 : 0
    }
    // 상단 5칸에 12씩 = 60. 식스만 남았다.
    for (const category of ['ones', 'twos', 'threes', 'fours', 'fives'] as const) {
      filled[category] = 12
    }
    const board = boardWith(filled, 60)

    const decision = policy.decide(board, [1, 2, 3, 4, 5], 3)

    expect(decision.category).toBe('yacht')
  })

  it('2리롤 전체 탐색이 턴당 지연 예산 안에서 끝난다', () => {
    // Java `searchesTwoRemainingRollsWithinTheTurnLatencyBudget`. 워밍업 후 측정한다.
    expect(() => policy.decide(emptyBoard(), [1, 2, 3, 5, 6], 1)).not.toThrow()

    const startedAt = performance.now()
    policy.decide(emptyBoard(), [1, 2, 3, 5, 6], 1)
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(1_000)
  })

  it('예산을 넘기면 스스로 중단한다 — 실시간을 기다리지 않는다', () => {
    // 시계를 주입해 "1초가 지난 척"한다. 예산 강제는 Java에 없는 우리 추가분이다.
    let clock = 0
    const budgeted = new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator(), {
      budgetMs: 1_000,
      now: () => {
        clock += 600
        return clock
      },
    })

    expect(() => budgeted.decide(emptyBoard(), [1, 2, 3, 5, 6], 1)).toThrow(BotSearchBudgetError)
  })

  it('리롤이 없는 결정은 예산과 무관하게 답을 낸다', () => {
    // rollCount 3은 탐색이 아니라 12칸 평가 하나다 — 예산 0이어도 통과해야 한다.
    const budgeted = new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator(), { budgetMs: 0 })

    expect(budgeted.decide(emptyBoard(), [6, 6, 6, 6, 6], 3).category).toBe('yacht')
  })

  it('입력 검증 — 주사위 5개·굴림 1..3', () => {
    expect(() => policy.decide(emptyBoard(), [1, 2, 3], 1)).toThrow(/five dice/)
    expect(() => policy.decide(emptyBoard(), [1, 2, 3, 4, 5], 0)).toThrow(/roll count/)
    expect(() => policy.decide(emptyBoard(), [1, 2, 3, 4, 5], 4)).toThrow(/roll count/)
  })
})
