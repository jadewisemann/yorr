import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryRoundStateStore,
  RoundState,
  RoundSubmission,
  type RoundSubmissionResult,
} from '../../round/index.js'
import { createScoreBoard, type ScoreBoard } from '../scoreBoard.js'
import type { ScoreBoardStore } from '../scoreBoardStore.js'
import type { ScoreCategory } from '../scoreCategory.js'
import { ScoreConfirmationService } from '../scoreConfirmationService.js'
import { isScoreConfirmationError, ScoreConfirmationError } from '../scoreErrors.js'
import {
  type CurrentGameLookup,
  type RoundSubmitPayloadLike,
  type RoundSubmitPort,
  ScoreRoundSubmissionService,
} from '../scoreRoundSubmissionService.js'

const ROOM_ID = 'room-a'
const GAME_ID = 'game-a'

/**
 * 2.5 `RoundSynchronizationService.submit`이 들어올 자리를 인메모리 스토어로
 * 대신한다 — 포트가 구조적이라 프로덕션 코드는 라운드 구체 타입을 모른다.
 */
class InMemoryRoundSubmitter implements RoundSubmitPort<RoundSubmissionResult> {
  constructor(readonly store: InMemoryRoundStateStore) {}

  async submit(
    roomId: string,
    playerId: string,
    payload: RoundSubmitPayloadLike,
    beforeStateChange: () => Promise<void>,
  ): Promise<RoundSubmissionResult> {
    return this.store.submitAtomically(
      roomId,
      new RoundSubmission(playerId, payload.roundNumber, payload.dice, payload.category),
      beforeStateChange,
    )
  }
}

interface ConfirmCall {
  readonly gameId: string
  readonly playerId: string
  readonly roundNumber: number
  readonly category: ScoreCategory
  readonly score: number
  readonly requestSignature: string
  /** 확정 시점에 라운드가 아직 커밋되지 않았음을 보는 관측점. */
  readonly submittedAtConfirmTime: readonly string[]
}

class ScriptedScoreBoardStore implements ScoreBoardStore {
  readonly calls: ConfirmCall[] = []
  failure: ScoreConfirmationError | null = null
  scoreboard: ScoreBoard = createScoreBoard({}, 0, 0, 0)
  observe: (() => Promise<readonly string[]>) | null = null

  async confirmScore(
    gameId: string,
    playerId: string,
    roundNumber: number,
    category: ScoreCategory,
    score: number,
    requestSignature: string,
  ): Promise<ScoreBoard> {
    const submittedAtConfirmTime = this.observe === null ? [] : await this.observe()
    this.calls.push({
      gameId,
      playerId,
      roundNumber,
      category,
      score,
      requestSignature,
      submittedAtConfirmTime,
    })
    if (this.failure !== null) throw this.failure
    return this.scoreboard
  }

  async findScoreBoard(): Promise<ScoreBoard> {
    return this.scoreboard
  }
}

const payload = (): RoundSubmitPayloadLike => ({
  roundNumber: 1,
  dice: [1, 1, 1, 1, 1],
  category: 'choice',
})

// backend-java `ScoreRoundSubmissionServiceTest` 이식.
describe('ScoreRoundSubmissionService', () => {
  let rounds: InMemoryRoundStateStore
  let store: ScriptedScoreBoardStore
  let gameId: string | null
  let service: ScoreRoundSubmissionService<RoundSubmissionResult>

  const rooms: CurrentGameLookup = {
    getSnapshot: async () => ({ gameId }),
  }

  const startRound = async (...participants: string[]): Promise<void> => {
    await rounds.initialize(ROOM_ID, RoundState.start(1, participants))
    await rounds.recordRollAtomically(
      ROOM_ID,
      participants[0] as string,
      1,
      1,
      [false, false, false, false, false],
      [1, 1, 1, 1, 1],
    )
  }

  beforeEach(() => {
    rounds = new InMemoryRoundStateStore()
    store = new ScriptedScoreBoardStore()
    store.observe = async () => (await rounds.findByRoomId(ROOM_ID))?.submittedPlayerIds ?? []
    gameId = GAME_ID
    service = new ScoreRoundSubmissionService(
      new InMemoryRoundSubmitter(rounds),
      new ScoreConfirmationService(store),
      rooms,
    )
  })

  it('라운드 제출을 기록하기 전에 점수를 확정한다', async () => {
    await startRound('player-a', 'player-b')
    store.scoreboard = createScoreBoard({ choice: 5 }, 0, 0, 5)

    const result = await service.submit(ROOM_ID, 'player-a', payload())

    expect(store.calls).toHaveLength(1)
    expect(store.calls[0]).toMatchObject({
      gameId: GAME_ID,
      playerId: 'player-a',
      roundNumber: 1,
      category: 'choice',
      score: 5,
      requestSignature: 'choice:1,1,1,1,1',
      // 확정 시점에는 아직 아무도 제출로 기록되지 않았다 = 커밋 전에 돈다.
      submittedAtConfirmTime: [],
    })
    expect(result.score?.score).toBe(5)
    expect(result.round.completedRound).toBeNull()
    expect((await rounds.findByRoomId(ROOM_ID))?.submittedPlayerIds).toEqual(['player-a'])
  })

  it('점수 저장이 실패하면 미제출로 남고 재시도할 수 있다', async () => {
    await startRound('player-a')
    store.failure = new ScoreConfirmationError('STORE_FAILURE', 'redis unavailable')

    await expect(service.submit(ROOM_ID, 'player-a', payload())).rejects.toThrow(
      ScoreConfirmationError,
    )
    const afterFailure = await rounds.findByRoomId(ROOM_ID)
    expect(afterFailure?.roundNumber).toBe(1)
    expect(afterFailure?.submittedPlayerIds).toEqual([])

    store.failure = null
    store.scoreboard = createScoreBoard({ choice: 5 }, 0, 0, 5)
    const retried = await service.submit(ROOM_ID, 'player-a', payload())

    expect(retried.round.completedRound).not.toBeNull()
    const afterRetry = await rounds.findByRoomId(ROOM_ID)
    expect(afterRetry?.roundNumber).toBe(2)
    expect(afterRetry?.submittedPlayerIds).toEqual([])
  })

  it('진행 중인 게임이 없으면 확정을 시도하지 않고 라운드도 그대로다', async () => {
    await startRound('player-a')
    gameId = null

    await expect(service.submit(ROOM_ID, 'player-a', payload())).rejects.toSatisfy(
      (error: unknown) => isScoreConfirmationError(error, 'GAME_NOT_FOUND'),
    )

    expect(store.calls).toHaveLength(0)
    expect((await rounds.findByRoomId(ROOM_ID))?.submittedPlayerIds).toEqual([])
  })

  it('라운드 검증에 실패하면 점수 확정 자체가 돌지 않는다', async () => {
    await startRound('player-a', 'player-b')

    // 활성 플레이어가 아닌 사람의 제출 — 라운드 검증에서 먼저 걸린다.
    await expect(service.submit(ROOM_ID, 'player-b', payload())).rejects.toThrow()
    expect(store.calls).toHaveLength(0)
  })
})
