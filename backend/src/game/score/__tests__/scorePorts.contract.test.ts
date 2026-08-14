import { expect, it } from 'vitest'
import {
  InMemoryRoundStateStore,
  type OpenCategoriesPort,
  RoundState,
  type RoundSubmissionResult,
  RoundSynchronizationService,
  type ScoreRoundSubmissionPort,
} from '../../round/index.js'
import { createScoreBoard, type ScoreBoard } from '../scoreBoard.js'
import type { ScoreBoardStore } from '../scoreBoardStore.js'
import { ScoreConfirmationService } from '../scoreConfirmationService.js'
import {
  type RoundSubmitPort,
  ScoreRoundSubmissionService,
} from '../scoreRoundSubmissionService.js'

/**
 * 2.5(라운드)와 2.6(점수)이 **어댑터 없이** 서로 꽂히는지 고정한다.
 *
 * 두 방향 모두 구조적 타이핑에만 의존한다 — 라운드는 점수 도메인을,
 * 점수는 라운드 구체 타입을 컴파일 의존으로 갖지 않는다. 어느 한쪽이 시그니처를
 * 바꾸면 **이 파일이 먼저 깨진다**(런타임 배선이 아니라 여기서 잡으라고 있는 파일).
 */
class StubScoreBoardStore implements ScoreBoardStore {
  async confirmScore(): Promise<ScoreBoard> {
    return createScoreBoard({ choice: 5 }, 0, 0, 5)
  }

  async findScoreBoard(): Promise<ScoreBoard> {
    return createScoreBoard({}, 0, 0, 0)
  }
}

it('RoundSynchronizationService(2.5)가 우리 라운드 제출 포트를 만족한다', async () => {
  const store = new InMemoryRoundStateStore()
  const rounds: RoundSubmitPort<RoundSubmissionResult> = new RoundSynchronizationService(store)
  const service = new ScoreRoundSubmissionService(
    rounds,
    new ScoreConfirmationService(new StubScoreBoardStore()),
    { getSnapshot: async () => ({ gameId: 'game-a' }) },
  )

  await store.initialize('room-a', RoundState.start(1, ['player-a']))
  await store.recordRollAtomically(
    'room-a',
    'player-a',
    1,
    1,
    [false, false, false, false, false],
    [1, 1, 1, 1, 1],
  )
  const result = await service.submit('room-a', 'player-a', {
    roundNumber: 1,
    dice: [1, 1, 1, 1, 1],
    category: 'choice',
  })

  expect(result.score?.score).toBe(5)
  expect(result.round.completedRound).not.toBeNull()

  // 2.5의 타이머가 잡는 자리(ScoreRoundSubmissionPort)에 그대로 들어간다.
  const port: ScoreRoundSubmissionPort<RoundSubmissionResult> = service
  expect(port).toBe(service)
})

it('ScoreConfirmationService가 2.5의 OpenCategoriesPort를 만족한다', async () => {
  const port: OpenCategoriesPort = new ScoreConfirmationService(new StubScoreBoardStore())

  // 타임아웃 해소가 고를 빈 칸 — api key 문자열로 오간다(enum을 넘기지 않는다).
  expect(await port.openCategories('game-a', 'player-a')).toHaveLength(12)
})
