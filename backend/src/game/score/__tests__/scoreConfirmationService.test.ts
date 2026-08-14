import { beforeEach, describe, expect, it } from 'vitest'
import { createScoreBoard, type ScoreBoard } from '../scoreBoard.js'
import type { ScoreBoardStore } from '../scoreBoardStore.js'
import type { ScoreCategory } from '../scoreCategory.js'
import {
  type ScoreConfirmationCommand,
  ScoreConfirmationService,
} from '../scoreConfirmationService.js'
import { isScoreConfirmationError, type ScoreConfirmationReason } from '../scoreErrors.js'

/** 이유 코드까지 확인한다 — 던졌다는 사실만으로는 계약을 지켰다고 할 수 없다. */
const expectReason = async (
  promise: Promise<unknown>,
  reason: ScoreConfirmationReason,
): Promise<void> => {
  await expect(promise).rejects.toThrow()
  await promise.catch((error: unknown) => {
    expect(isScoreConfirmationError(error, reason)).toBe(true)
  })
}

/** Java 테스트의 `CapturingScoreBoardStore`. */
class CapturingScoreBoardStore implements ScoreBoardStore {
  scoreboard: ScoreBoard = createScoreBoard({}, 0, 0, 0)
  roundNumber = 0
  category: ScoreCategory | null = null
  score = 0
  requestSignature = ''

  async confirmScore(
    _gameId: string,
    _playerId: string,
    roundNumber: number,
    category: ScoreCategory,
    score: number,
    requestSignature: string,
  ): Promise<ScoreBoard> {
    this.roundNumber = roundNumber
    this.category = category
    this.score = score
    this.requestSignature = requestSignature
    return this.scoreboard
  }

  async findScoreBoard(): Promise<ScoreBoard> {
    return this.scoreboard
  }
}

const command = (
  roundNumber: number,
  category: string,
  dice: readonly number[],
): ScoreConfirmationCommand => ({
  gameId: 'game-1',
  playerId: 'player-1',
  roundNumber,
  category,
  dice,
})

// backend-java `ScoreConfirmationServiceTest` 이식.
describe('ScoreConfirmationService', () => {
  let store: CapturingScoreBoardStore
  let service: ScoreConfirmationService

  beforeEach(() => {
    store = new CapturingScoreBoardStore()
    service = new ScoreConfirmationService(store)
  })

  it('점수를 서버가 재계산하고 갱신된 점수판을 돌려준다', async () => {
    store.scoreboard = createScoreBoard({ fullHouse: 19 }, 0, 0, 19)

    const result = await service.confirm(command(3, 'fullHouse', [3, 3, 3, 5, 5]))

    expect(result.score).toBe(19)
    expect(result.category).toBe('fullHouse')
    expect(result.scoreboard).toBe(store.scoreboard)
    expect(store.category).toBe('fullHouse')
    expect(store.score).toBe(19)
    expect(store.roundNumber).toBe(3)
    expect(store.requestSignature).toBe('fullHouse:3,3,3,5,5')
  })

  it('희생한 칸은 0점으로 확정한다', async () => {
    store.scoreboard = createScoreBoard({ yacht: 0 }, 0, 0, 0)

    const result = await service.confirm(command(1, 'yacht', [1, 2, 3, 4, 5]))

    expect(result.score).toBe(0)
    expect(result.scoreboard.categories.yacht).toBe(0)
  })

  /** 시그니처가 주사위 순서에 민감하다는 것이 멱등 재시도 판정의 전제다. */
  it('시그니처는 주사위 순서를 그대로 담는다', async () => {
    await service.confirm(command(1, 'choice', [5, 4, 3, 2, 1]))
    expect(store.requestSignature).toBe('choice:5,4,3,2,1')
  })

  it('아직 비어 있는 칸만 열거한다', async () => {
    store.scoreboard = createScoreBoard({ yacht: 0, fullHouse: 19 }, 0, 0, 19)

    const open = await service.openCategories('game-1', 'player-1')

    expect(open).not.toContain('yacht')
    expect(open).not.toContain('fullHouse')
    expect(open).toHaveLength(10)
    expect(open[0]).toBe('ones')
  })

  it('모르는 카테고리는 INVALID_CATEGORY다', async () => {
    await expectReason(service.confirm(command(1, 'unknown', [1, 2, 3, 4, 5])), 'INVALID_CATEGORY')
  })

  it('잘못된 주사위는 INVALID_DICE다', async () => {
    await expectReason(service.confirm(command(1, 'choice', [1, 2, 3, 4, 7])), 'INVALID_DICE')
  })

  it('null이 섞인 주사위는 INVALID_DICE다', async () => {
    const dice = [1, 2, null, 4, 5] as unknown as number[]
    await expectReason(service.confirm(command(1, 'choice', dice)), 'INVALID_DICE')
  })

  it('빈 식별자·0 이하 라운드는 저장소에 닿기 전에 거부한다', async () => {
    await expect(
      service.confirm({ ...command(1, 'choice', [1, 2, 3, 4, 5]), gameId: '' }),
    ).rejects.toThrow(/gameId/)
    await expect(
      service.confirm({ ...command(1, 'choice', [1, 2, 3, 4, 5]), playerId: ' ' }),
    ).rejects.toThrow(/playerId/)
    await expect(service.confirm(command(0, 'choice', [1, 2, 3, 4, 5]))).rejects.toThrow(
      /roundNumber/,
    )
    expect(store.category).toBeNull()
  })
})
