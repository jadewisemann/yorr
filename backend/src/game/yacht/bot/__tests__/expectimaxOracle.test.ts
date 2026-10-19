import { describe, expect, it } from 'vitest'
import { createPrng, iterationsFromEnv, seedFromEnv } from '../../../../../test/fuzz/prng.js'
import { boardFrom, type NamedBoard, randomBoard } from '../../../../../test/fuzz/yachtBoards.js'
import { YACHT_CATEGORIES, type YachtCategory } from '../../../../../test/oracles/yacht.js'
import {
  EARLY_SCORE_MARGIN,
  everyDiceMultiset,
  YachtBotOracle,
} from '../../../../../test/oracles/yachtBot.js'
import type { ScoreBoard } from '../../../score/index.js'
import { type BotDecision, ExpectimaxYachtBotPolicy } from '../expectimaxYachtBotPolicy.js'
import { ScorecardValueEvaluator } from '../scorecardValueEvaluator.js'

/**
 * 봇 정책 ↔ 독립 오라클 차등 테스트(`test/oracles/yachtBot.ts`).
 *
 * SQLite가 다른 엔진과 같은 질의 결과를 대조하듯, 같은 평가기 아래에서 운영 정책과 오라클이
 * **모든 주사위 다중집합(252) × 굴림 번호**에서 같은 판단을 내리는지 본다. 단정하는 것:
 *
 * 1. 운영 정책이 고른 칸의 효용 = 오라클의 최선 효용(동점이면 칸은 달라도 된다).
 * 2. 운영 정책이 킵을 골랐다면, 그 킵의 기대값 = 오라클의 최선 킵 기대값이고, 오라클이 계산한
 *    **그 킵 자체의** 기대값과도 같다(결정과 보고한 숫자가 서로 맞는다).
 * 3. 기록/킵 선택이 규칙(0.15 여유)과 맞는다.
 *
 * 점수판은 경계 상태(빈 판·칸 하나만 열림·보너스 문턱)와 시드 고정 무작위 판을 섞는다.
 * 시드는 실패 메시지에 실려 그대로 재현된다. 야간 실행은 `BOT_ORACLE_BOARDS`로 판을 늘린다.
 */

const TOLERANCE = 1e-9
const evaluator = new ScorecardValueEvaluator()
// 예산은 끈다 — 여기서 보는 것은 탐색의 정답이지 시간이 아니다.
const policy = new ExpectimaxYachtBotPolicy(evaluator, { budgetMs: Number.POSITIVE_INFINITY })

/** 굴림 번호 3·2를 전수로 보는 판. 경계 상태가 먼저다. */
const edgeBoards = (): NamedBoard[] => [
  boardFrom('빈 판', {}),
  // 칸 하나만 열림 — 열두 가지 전부. 선택지가 하나라 "킵 vs 기록"만 남는다.
  ...YACHT_CATEGORIES.map((open) =>
    boardFrom(
      `${open}만 열림`,
      Object.fromEntries(YACHT_CATEGORIES.filter((c) => c !== open).map((c) => [c, 0])),
    ),
  ),
  // 상단 보너스 문턱 바로 아래 — 확보 프리미엄이 결정을 뒤집는 자리다.
  boardFrom('보너스 1점 모자람', { ones: 3, twos: 6, threes: 12, fours: 16, fives: 25 }),
  boardFrom('보너스 이미 확보', { ones: 5, twos: 10, threes: 15, fours: 20, fives: 25 }),
  boardFrom('보너스 불가능', { fours: 0, fives: 0, sixes: 0 }),
  // 초이스·스몰 스트레이트가 함께 열린 판 — 둘의 우열이 점수판에 따라 바뀐다.
  boardFrom('초이스·스몰만 열림', {
    ones: 3,
    twos: 6,
    threes: 9,
    fours: 12,
    fives: 15,
    sixes: 18,
    fourOfAKind: 0,
    fullHouse: 0,
    largeStraight: 0,
    yacht: 0,
  }),
]

const scoreUtility = (board: ScoreBoard, decision: BotDecision, dice: readonly number[]): number =>
  new YachtBotOracle(board, [decision.category as YachtCategory], evaluator).bestScore(dice).utility

const heldMultiset = (dice: readonly number[], held: readonly boolean[]): string =>
  dice
    .filter((_, index) => held[index])
    .sort((left, right) => left - right)
    .join('')

/** 한 판의 모든 다중집합 × 주어진 굴림 번호를 대조한다. 어긋난 곳을 모아 한 번에 보고한다. */
const compareBoard = (named: NamedBoard, rollCounts: readonly number[]): string[] => {
  const oracle = new YachtBotOracle(named.board, named.open, evaluator)
  const mismatches: string[] = []
  const report = (dice: readonly number[], rollCount: number, what: string): void => {
    mismatches.push(`[${named.name}] dice=${dice.join('')} roll=${rollCount}: ${what}`)
  }
  for (const dice of everyDiceMultiset()) {
    for (const rollCount of rollCounts) {
      const expected = oracle.analyze(dice, rollCount)
      const decision = policy.decide(named.board, dice, rollCount)

      if (decision.action === 'SCORE') {
        const category = decision.category as YachtCategory
        if (!named.open.includes(category)) {
          report(dice, rollCount, `채워진 칸 ${category}에 기록했다`)
          continue
        }
        const utility = scoreUtility(named.board, decision, dice)
        if (Math.abs(utility - expected.score.utility) > TOLERANCE) {
          report(
            dice,
            rollCount,
            `${category}(${utility.toFixed(4)})를 골랐지만 최선은 ` +
              `${expected.score.category}(${expected.score.utility.toFixed(4)})`,
          )
        }
        if (Math.abs(decision.expectedUtility - utility) > TOLERANCE) {
          report(
            dice,
            rollCount,
            `보고한 효용 ${decision.expectedUtility}이 칸의 효용 ${utility}과 다르다`,
          )
        }
      } else {
        const kept = heldMultiset(dice, decision.held)
        const keptValue = expected.holdValues.get(kept)
        if (keptValue === undefined || expected.holdValue === null) {
          report(dice, rollCount, `오라클에 없는 킵 ${kept}`)
          continue
        }
        if (Math.abs(keptValue - expected.holdValue) > TOLERANCE) {
          report(dice, rollCount, `킵 ${kept}(${keptValue})는 최선(${expected.holdValue})이 아니다`)
        }
        if (Math.abs(decision.expectedUtility - keptValue) > TOLERANCE) {
          report(
            dice,
            rollCount,
            `보고한 기대값 ${decision.expectedUtility} ≠ 킵의 기대값 ${keptValue}`,
          )
        }
      }

      // 규칙 2 — 여유 경계에 정확히 걸린 경우(부동소수 오차 안)는 어느 쪽도 옳다.
      if (expected.holdValue !== null) {
        const margin = expected.score.utility + EARLY_SCORE_MARGIN - expected.holdValue
        if (Math.abs(margin) > TOLERANCE && decision.action !== expected.action) {
          report(dice, rollCount, `${expected.action}여야 하는데 ${decision.action}을 골랐다`)
        }
      }
    }
  }
  return mismatches
}

const expectNoMismatch = (mismatches: string[]): void => {
  // 252 × n개를 다 찍으면 읽을 수 없다 — 앞의 몇 개와 총수만 싣는다.
  expect(mismatches.slice(0, 8), `불일치 ${mismatches.length}건`).toEqual([])
}

describe('봇 정책 ↔ 오라클 (전수)', () => {
  for (const named of edgeBoards()) {
    it(`${named.name}: 굴림 2·3에서 252가지 전부 일치한다`, () => {
      expectNoMismatch(compareBoard(named, [2, 3]))
    })
  }

  // 굴림 1은 탐색이 가장 깊어(리롤 2회) 한 판에 수 초가 든다. PR에서는 경계 판 둘만,
  // 야간은 `BOT_ORACLE_DEEP_BOARDS`로 늘린다.
  const deep = edgeBoards().slice(0, iterationsFromEnv('BOT_ORACLE_DEEP_BOARDS', 2))
  // 야간은 판 수를 늘리므로 timeout도 함께 늘린다 — 고정값이면 느린 러너에서 시간 초과한다.
  const deepTimeoutMs = Math.max(120_000, deep.length * 30_000)
  for (const named of deep) {
    it(`${named.name}: 굴림 1에서 252가지 전부 일치한다`, { timeout: deepTimeoutMs }, () => {
      expectNoMismatch(compareBoard(named, [1]))
    })
  }
})

describe('봇 정책 ↔ 오라클 (시드 고정 무작위 판)', () => {
  const seed = seedFromEnv('BOT_ORACLE_SEED')
  const boards = iterationsFromEnv('BOT_ORACLE_BOARDS', 6)
  const boardsTimeoutMs = Math.max(120_000, boards * 10_000)
  it(`판 ${boards}개 × 굴림 2·3 (seed=${seed})`, { timeout: boardsTimeoutMs }, () => {
    const prng = createPrng(seed)
    const mismatches: string[] = []
    for (let index = 0; index < boards; index += 1) {
      mismatches.push(...compareBoard(randomBoard(prng.int(0, 2 ** 31 - 1)), [2, 3]))
    }
    expectNoMismatch(mismatches)
  })
})
