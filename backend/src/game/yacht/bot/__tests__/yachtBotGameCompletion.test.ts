import { describe, expect, it } from 'vitest'
import {
  InMemoryRoundStateStore,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  seededDieRoller,
} from '../../../round/index.js'
import {
  SCORE_CATEGORIES,
  ScoreConfirmationService,
  ScoreRoundSubmissionService,
} from '../../../score/index.js'
import { FakeRoundTimer, RecordingBroadcaster } from '../../__tests__/testDoubles.js'
import { YachtTurnActionService } from '../../yachtTurnActionService.js'
import { ExpectimaxYachtBotPolicy } from '../expectimaxYachtBotPolicy.js'
import { LocalYachtBotStrategy } from '../localYachtBotStrategy.js'
import { ScorecardValueEvaluator } from '../scorecardValueEvaluator.js'
import { YachtBotTurnCoordinator } from '../yachtBotTurnCoordinator.js'
import { AccumulatingScoreBoardStore, roomWith } from './botTestDoubles.js'

/**
 * `YachtBotGameCompletionTest` 이식 — **2봇이 12라운드를 사람과 같은 경로로 완주**한다.
 *
 * 이 스위트에서 유일하게 대역이 아닌 것들: 라운드 동기화 서비스, 진짜
 * `YachtTurnActionService`, 진짜 점수 확정 서비스, 진짜 정책·폴백. 대역은 타이머
 * (마감 발화는 2.5가 덮었다)·브로드캐스터·방 스냅샷·점수 저장소뿐이다.
 *
 * 오케스트레이터는 여기서 쓰지 않는다 — 지연 4종을 실시간으로 기다리면 12라운드가
 * 몇 분이 된다. 대신 Java 테스트와 같이 코디네이터를 루프에서 직접 돌린다.
 */

const ROOM = 'room-a'
const GAME = 'game-a'
const BOTS = ['bot-easy', 'bot-hard'] as const

describe('야추 봇 완주', () => {
  it('2봇이 공유 행동 경로로 12라운드를 끝낸다', async () => {
    const rounds = new RoundSynchronizationService(new InMemoryRoundStateStore(), {
      // 서버 RNG를 시드로 고정한다(2.5의 시임) — 실패가 재현 가능해야 한다.
      dieRoller: seededDieRoller(20260814),
    })
    const scoreStore = new AccumulatingScoreBoardStore()
    const scores = new ScoreConfirmationService(scoreStore)
    const rooms = {
      getSnapshot: async () =>
        roomWith(
          GAME,
          BOTS.map((playerId) => ({ playerId, kind: 'BOT' as const })),
        ),
    }
    const submissions = new ScoreRoundSubmissionService<RoundSubmissionResult>(
      rounds,
      scores,
      rooms,
    )
    const timers = new FakeRoundTimer()
    const broadcaster = new RecordingBroadcaster()
    const actions = new YachtTurnActionService({ rounds, timers, broadcaster, submissions })
    const coordinator = new YachtBotTurnCoordinator({
      rounds,
      actions,
      policy: new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator()),
      strategy: new LocalYachtBotStrategy(),
      rooms,
      scores,
    })

    await rounds.initialize(ROOM, 1, [...BOTS])

    let steps = 0
    for (;;) {
      const state = await rounds.findByRoomId(ROOM)
      expect(state).toBeDefined()
      if (state === undefined || state.finished || steps >= 200) break
      // **모든 스텝이 실제 행동이어야 한다.** 하나라도 무시되면 봇이 멈춘 것이고,
      // 그러면 아래 루프가 200번 돌아 실패한다.
      expect(await coordinator.playIfCurrent({ roomId: ROOM, state })).toBe(true)
      steps += 1
    }

    const finished = await rounds.findByRoomId(ROOM)
    expect(finished?.finished).toBe(true)
    expect(finished?.roundNumber).toBe(12)
    // 라운드당 봇 하나가 최소 2스텝(굴림 + 제출), 최대 6스텝(굴림3 + 킵2 + 제출).
    expect(steps).toBeGreaterThanOrEqual(48)
    expect(steps).toBeLessThanOrEqual(144)

    for (const botId of BOTS) {
      const board = await scoreStore.findScoreBoard(GAME, botId)
      for (const category of SCORE_CATEGORIES) {
        expect(board.categories[category], `${botId}/${category}`).not.toBeNull()
      }
    }
  }, 60_000)
})
