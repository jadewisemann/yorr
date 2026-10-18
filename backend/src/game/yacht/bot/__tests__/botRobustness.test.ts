import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  createPrng,
  iterationsFromEnv,
  type Prng,
  seedFromEnv,
} from '../../../../../test/fuzz/prng.js'
import { randomBoard, randomDice } from '../../../../../test/fuzz/yachtBoards.js'
import { oracleScore, oracleSheet, type YachtCategory } from '../../../../../test/oracles/yacht.js'
import {
  InMemoryRoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  seededDieRoller,
} from '../../../round/index.js'
import {
  createScoreBoard,
  isUpperCategory,
  SCORE_CATEGORIES,
  type ScoreBoard,
  type ScoreCategory,
  ScoreConfirmationService,
  ScoreRoundSubmissionService,
} from '../../../score/index.js'
import { FakeRoundTimer, RecordingBroadcaster } from '../../__tests__/testDoubles.js'
import { YachtTurnActionService } from '../../yachtTurnActionService.js'
import { BotSearchBudgetError } from '../botErrors.js'
import type { YachtBotPolicy } from '../botPorts.js'
import {
  type BotDecision,
  DEFAULT_SEARCH_BUDGET_MS,
  ExpectimaxYachtBotPolicy,
} from '../expectimaxYachtBotPolicy.js'
import { LocalYachtBotStrategy } from '../localYachtBotStrategy.js'
import { ScorecardValueEvaluator } from '../scorecardValueEvaluator.js'
import { YachtBotTurnCoordinator } from '../yachtBotTurnCoordinator.js'
import { AccumulatingScoreBoardStore, roomWith } from './botTestDoubles.js'

/**
 * 봇 스택의 견고성 — SQLite 테스트 방식을 그대로 옮긴다.
 *
 * - **속성 퍼저**: 시드 고정 무작위 상태에서 결정이 언제나 합법이고, 결정론적이고, 주사위 순서에
 *   무관한지 본다. 시드는 테스트 이름에 실려 실패가 그대로 재현된다.
 * - **장애 주입 스윕**: SQLite가 "N번째 malloc만 실패"를 모든 N에 대해 반복하듯, 예산 시계가
 *   **N번째 읽기에서 초과**되게 해 모든 N을 훑는다. 중간 어디서 끊겨도 반쯤 된 결정이 새면
 *   안 되고(예산 오류만 나야 한다), 끊기지 않으면 끊지 않은 결정과 똑같아야 한다.
 * - **혼돈 완주**: 정책이 무작위로 실패하는 상태에서 실제 서비스로 12라운드를 끝까지 둔다.
 * - **대량 시뮬레이션**: 시드 고정 1인 게임 수십 판 — 점수판이 오라클과 맞는지, 그리고
 *   정책이 폴백 전략보다 실제로 잘 두는지(품질 회귀 감시).
 *
 * 야간 실행은 `BOT_FUZZ_ITERATIONS`·`BOT_SWEEP_STRIDE`·`BOT_SIM_GAMES`로 키운다.
 */

const evaluator = new ScorecardValueEvaluator()
const unbudgeted = new ExpectimaxYachtBotPolicy(evaluator, { budgetMs: Number.POSITIVE_INFINITY })

const heldFaces = (dice: readonly number[], decision: BotDecision): string =>
  dice
    .filter((_, index) => decision.held[index])
    .sort((left, right) => left - right)
    .join('')

const shuffle = <T>(items: readonly T[], prng: Prng): T[] => {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = prng.int(0, index)
    ;[copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T]
  }
  return copy
}

/** 굴림 1은 탐색이 깊어 비싸다 — 퍼저는 대부분 2·3을 보고 가끔 1을 본다. */
const randomRollCount = (prng: Prng): number => (prng.chance(0.1) ? 1 : prng.int(2, 3))

const expectLegal = (
  board: ScoreBoard,
  dice: readonly number[],
  rollCount: number,
  decision: BotDecision,
): void => {
  if (decision.action === 'SCORE') {
    expect(decision.category).not.toBeNull()
    expect(board.categories[decision.category as ScoreCategory], '채워진 칸에 기록').toBeNull()
    expect(decision.held).toEqual([])
  } else {
    expect(rollCount, '마지막 굴림에는 킵이 없다').toBeLessThan(3)
    expect(decision.category).toBeNull()
    expect(decision.held).toHaveLength(dice.length)
    expect(decision.held.every(Boolean), '다섯 개 전부 킵은 기록으로 표현한다').toBe(false)
  }
  expect(Number.isFinite(decision.expectedUtility)).toBe(true)
}

describe('봇 정책 속성 퍼저', () => {
  const seed = seedFromEnv('BOT_FUZZ_SEED')
  const iterations = iterationsFromEnv('BOT_FUZZ_ITERATIONS', 300)

  it(`합법·결정론·순서 무관 (seed=${seed}, ${iterations}회)`, { timeout: 120_000 }, () => {
    const prng = createPrng(seed)
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const { board } = randomBoard(prng.int(0, 2 ** 31 - 1))
      const dice = randomDice(prng)
      const rollCount = randomRollCount(prng)
      const context = `iteration=${iteration} dice=${dice.join('')} roll=${rollCount}`

      const decision = unbudgeted.decide(board, dice, rollCount)
      expectLegal(board, dice, rollCount, decision)

      // 결정론: 같은 입력이면 같은 답. 새 인스턴스여도 같다(메모가 호출 사이에 새지 않는다).
      const again = new ExpectimaxYachtBotPolicy(evaluator, {
        budgetMs: Number.POSITIVE_INFINITY,
      }).decide(board, dice, rollCount)
      expect(again, context).toEqual(decision)

      // 순서 무관: 주사위를 섞어도 행동·칸·킵한 면·기대값이 같다. 자리 플래그만 따라 움직인다.
      const shuffled = shuffle(dice, prng)
      const permuted = unbudgeted.decide(board, shuffled, rollCount)
      expect(permuted.action, context).toBe(decision.action)
      expect(permuted.category, context).toBe(decision.category)
      expect(permuted.expectedUtility, context).toBe(decision.expectedUtility)
      expect(heldFaces(shuffled, permuted), context).toBe(heldFaces(dice, decision))
    }
  })

  it('입력이 틀리면 결정 대신 BotDecisionError를 던진다', () => {
    const board = createScoreBoard({}, 0, 0, 0)
    const full = createScoreBoard(
      Object.fromEntries(SCORE_CATEGORIES.map((category) => [category, 0])),
      0,
      0,
      0,
    )
    const invalid: [ScoreBoard, number[], number][] = [
      [board, [1, 2, 3, 4], 1],
      [board, [1, 2, 3, 4, 5, 6], 1],
      [board, [0, 2, 3, 4, 5], 1],
      [board, [1, 2, 3, 4, 7], 1],
      [board, [1, 2, 3, 4, 2.5], 1],
      [board, [1, 2, 3, 4, 5], 0],
      [board, [1, 2, 3, 4, 5], 4],
      [full, [1, 2, 3, 4, 5], 3],
    ]
    for (const [target, dice, rollCount] of invalid) {
      expect(() => unbudgeted.decide(target, dice, rollCount), `${dice} roll=${rollCount}`).toThrow(
        /five dice|roll count|no open score category/,
      )
    }
  })
})

/**
 * 시계를 N번째 읽기부터 무한히 미래로 보낸다. 0번째 읽기는 탐색 시작 시각이다.
 * `reads`로 몇 번 읽혔는지 센다 — 스윕의 끝(N의 최댓값)을 정하는 데 쓴다.
 */
const exhaustingClock = (exhaustAt: number) => {
  let reads = 0
  return {
    now: (): number => {
      reads += 1
      return reads > exhaustAt ? Number.POSITIVE_INFINITY : 0
    },
    reads: () => reads,
  }
}

describe('예산 장애 주입 스윕', () => {
  const stride = iterationsFromEnv('BOT_SWEEP_STRIDE', 7)
  const cases: { name: string; board: ScoreBoard; dice: number[]; rollCount: number }[] = [
    {
      name: '빈 판·굴림 1(가장 깊은 탐색)',
      board: createScoreBoard({}, 0, 0, 0),
      dice: [1, 3, 3, 5, 6],
      rollCount: 1,
    },
    {
      name: '무작위 판·굴림 2',
      board: randomBoard(424242).board,
      dice: [2, 2, 4, 5, 6],
      rollCount: 2,
    },
  ]

  for (const scenario of cases) {
    it(`${scenario.name}: 어느 읽기에서 끊겨도 예산 오류만 나고, 끊기지 않으면 결과가 같다`, {
      timeout: 120_000,
    }, () => {
      const reference = unbudgeted.decide(scenario.board, scenario.dice, scenario.rollCount)
      // 끊지 않고 한 번 돌려 시계를 몇 번 읽는지 센다.
      const dry = exhaustingClock(Number.POSITIVE_INFINITY)
      new ExpectimaxYachtBotPolicy(evaluator, { budgetMs: 1, now: dry.now }).decide(
        scenario.board,
        scenario.dice,
        scenario.rollCount,
      )
      const total = dry.reads()
      expect(total, '탐색이 예산을 한 번도 확인하지 않는다').toBeGreaterThan(1)

      // 1..total을 훑는다(PR은 간격을 두고, 마지막 읽기는 항상 포함한다).
      const points = new Set<number>([1, total - 1, total])
      for (let at = 1; at < total; at += stride) points.add(at)
      for (const exhaustAt of points) {
        const clock = exhaustingClock(exhaustAt)
        const policy = new ExpectimaxYachtBotPolicy(evaluator, { budgetMs: 1, now: clock.now })
        let outcome: BotDecision | unknown
        try {
          outcome = policy.decide(scenario.board, scenario.dice, scenario.rollCount)
        } catch (error) {
          outcome = error
        }
        if (exhaustAt < total) {
          expect(outcome, `exhaustAt=${exhaustAt}/${total}`).toBeInstanceOf(BotSearchBudgetError)
        } else {
          expect(outcome, `exhaustAt=${exhaustAt}/${total}`).toEqual(reference)
        }
      }
    })
  }

  it('예산 기본값은 실측 p99의 수 배다 — 이벤트 루프 점유의 상한', () => {
    // docs/design/games/yacht.md 「CPU 예산과 이벤트 루프」: 무거운 결정 p99 ≈ 18ms(코어 하나),
    // 0.5 vCore에서 벽시계 2배. 상한이 너무 크면 병리적 상황에서 다른 방 전부가 그만큼 멈춘다.
    expect(DEFAULT_SEARCH_BUDGET_MS).toBeLessThanOrEqual(250)
    expect(DEFAULT_SEARCH_BUDGET_MS).toBeGreaterThanOrEqual(100)
  })
})

/** 실제 서비스로 2봇 12라운드. `policy`만 바꿔 끼운다. */
const playFullGame = async (policy: YachtBotPolicy, seed: number) => {
  const room = 'room-chaos'
  const game = 'game-chaos'
  const bots = ['bot-a', 'bot-b'] as const
  const rounds = new RoundSynchronizationService(new InMemoryRoundStateStore(), {
    dieRoller: seededDieRoller(seed),
  })
  const scoreStore = new AccumulatingScoreBoardStore()
  const scores = new ScoreConfirmationService(scoreStore)
  const rooms = {
    getSnapshot: async () =>
      roomWith(
        game,
        bots.map((playerId) => ({ playerId, kind: 'BOT' as const })),
      ),
  }
  const submissions = new ScoreRoundSubmissionService<RoundSubmissionResult>(rounds, scores, rooms)
  const actions = new YachtTurnActionService({
    rounds,
    timers: new FakeRoundTimer(),
    broadcaster: new RecordingBroadcaster(),
    submissions,
  })
  const fallbacks: unknown[] = []
  const coordinator = new YachtBotTurnCoordinator(
    { rounds, actions, policy, strategy: new LocalYachtBotStrategy(), rooms, scores },
    { onPolicyFallback: (_roomId, _state, error) => fallbacks.push(error) },
  )
  await rounds.initialize(room, 1, [...bots])
  let steps = 0
  for (;;) {
    const state = await rounds.findByRoomId(room)
    if (state === undefined || state.finished || steps >= 200) break
    // 어떤 스텝도 무시되면 안 된다 — 봇이 멈추면 방 전체가 25초 타임아웃을 기다린다.
    expect(await coordinator.playIfCurrent({ roomId: room, state }), `step=${steps}`).toBe(true)
    steps += 1
  }
  const finished = await rounds.findByRoomId(room)
  const boards = await Promise.all(bots.map((botId) => scoreStore.findScoreBoard(game, botId)))
  return { finished, boards, fallbacks }
}

/** 시드에 따라 `rate` 비율로 실패하는 정책. 실패 종류도 섞는다(예산 초과·임의 예외). */
const flakyPolicy = (rate: number, seed: number): YachtBotPolicy => {
  const prng = createPrng(seed)
  return {
    decide: (board, dice, rollCount) => {
      if (prng.chance(rate)) {
        if (prng.chance(0.5)) throw new BotSearchBudgetError(1, 2)
        throw new Error('탐색 중 알 수 없는 오류')
      }
      return unbudgeted.decide(board, dice, rollCount)
    },
  }
}

describe('혼돈 완주', () => {
  const expectCompleteBoards = (boards: readonly ScoreBoard[]): void => {
    for (const board of boards) {
      for (const category of SCORE_CATEGORIES)
        expect(board.categories[category], category).not.toBeNull()
    }
  }

  for (const rate of [0.3, 1]) {
    it(`정책이 ${rate * 100}% 확률로 실패해도 12라운드를 끝낸다`, { timeout: 60_000 }, async () => {
      const { finished, boards, fallbacks } = await playFullGame(flakyPolicy(rate, 7), 20261018)
      expect(finished?.finished).toBe(true)
      expect(finished?.roundNumber).toBe(12)
      expectCompleteBoards(boards)
      expect(fallbacks.length).toBeGreaterThan(0)
    })
  }

  it('예산 0의 운영 정책으로도 끝낸다(모든 탐색이 첫 확인에서 끊긴다)', {
    timeout: 60_000,
  }, async () => {
    let clock = 0
    const policy = new ExpectimaxYachtBotPolicy(evaluator, { budgetMs: 0, now: () => (clock += 1) })
    const { finished, boards, fallbacks } = await playFullGame(policy, 99)
    expect(finished?.finished).toBe(true)
    expectCompleteBoards(boards)
    expect(fallbacks.every((error) => error instanceof BotSearchBudgetError)).toBe(true)
  })
})

/** 1인 12라운드를 정책만으로 둔다(서비스 없이). 점수판은 채점 오라클로 계산한다. */
const simulateSolo = (
  decide: (board: ScoreBoard, dice: readonly number[], rollCount: number) => BotDecision,
  prng: Prng,
) => {
  const recorded: Partial<Record<YachtCategory, number>> = {}
  let slowest = 0
  for (let round = 0; round < 12; round += 1) {
    const sheet = oracleSheet(recorded)
    const board = createScoreBoard(recorded, sheet.upperSubtotal, sheet.upperBonus, sheet.total)
    let dice = randomDice(prng)
    for (let rollCount = 1; ; rollCount += 1) {
      const startedAt = performance.now()
      const decision = decide(board, dice, rollCount)
      slowest = Math.max(slowest, performance.now() - startedAt)
      expectLegal(board, dice, rollCount, decision)
      if (decision.action === 'SCORE') {
        const category = decision.category as YachtCategory
        expect(recorded[category], `${category}를 두 번 기록`).toBeUndefined()
        recorded[category] = oracleScore(category, dice)
        break
      }
      dice = dice.map((die, index) => (decision.held[index] ? die : prng.int(1, 6)))
    }
  }
  return { sheet: oracleSheet(recorded), slowest }
}

describe('대량 시뮬레이션', () => {
  const seed = seedFromEnv('BOT_SIM_SEED')
  const games = iterationsFromEnv('BOT_SIM_GAMES', 30)

  it(`정책은 ${games}판 모두 12칸을 한 번씩 채우고 폴백보다 잘 둔다 (seed=${seed})`, {
    timeout: 180_000,
  }, () => {
    const local = new LocalYachtBotStrategy()
    const localDecide = (
      board: ScoreBoard,
      dice: readonly number[],
      rollCount: number,
    ): BotDecision => {
      const open = SCORE_CATEGORIES.filter((category) => board.categories[category] === null)
      const held = local.chooseHeld(dice)
      if (rollCount === 3 || held.every(Boolean)) {
        return {
          action: 'SCORE',
          held: [],
          category: local.chooseCategory(dice, open),
          expectedUtility: 0,
        }
      }
      return { action: 'HOLD', held, category: null, expectedUtility: 0 }
    }

    let policyTotal = 0
    let localTotal = 0
    let slowest = 0
    for (let index = 0; index < games; index += 1) {
      // 같은 게임 시드를 두 전략에 준다 — 첫 굴림이 같아야 비교가 공정하다.
      const gameSeed = createPrng(seed + index).int(0, 2 ** 31 - 1)
      const played = simulateSolo((b, d, r) => unbudgeted.decide(b, d, r), createPrng(gameSeed))
      const baseline = simulateSolo(localDecide, createPrng(gameSeed))
      for (const [category, score] of Object.entries(played.sheet.categories)) {
        expect(score, `game=${index} ${category} 미기록`).not.toBeNull()
        if (isUpperCategory(category as YachtCategory)) expect(score).toBeGreaterThanOrEqual(0)
      }
      policyTotal += played.sheet.total
      localTotal += baseline.sheet.total
      slowest = Math.max(slowest, played.slowest)
    }

    // 품질 회귀 감시. 실측(2026-10-18, 시드 1~3 · 30판): 정책 평균 ≈ 178점, 폴백 ≈ 103점.
    expect(policyTotal / games).toBeGreaterThan(localTotal / games)
    expect(policyTotal / games).toBeGreaterThan(150)
    // 성능 회귀 감시 — 예산이 상한을 보장하지만, 정상 탐색이 예산에 닿기 시작하면 봇이 조용히
    // 폴백으로만 두게 된다. 그 전에 여기서 빨개진다. 실측 최댓값 ≈ 47ms(JIT 예열 포함, 코어 하나).
    expect(slowest, '가장 느린 결정(ms)').toBeLessThan(DEFAULT_SEARCH_BUDGET_MS)
  })
})
