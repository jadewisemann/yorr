import { openCategoriesOf, type ScoreBoard } from './scoreBoard.js'
import type { ScoreBoardStore } from './scoreBoardStore.js'
import { type ScoreCategory, scoreCategoryOf } from './scoreCategory.js'
import { ScoreConfirmationError, ScoreDomainError } from './scoreErrors.js'
import { calculateScore } from './yachtScoreCalculator.js'

/** Java `ScoreConfirmationCommand` record 자리. `category`는 아직 검증 전 문자열이다. */
export interface ScoreConfirmationCommand {
  readonly gameId: string
  readonly playerId: string
  readonly roundNumber: number
  /** 클라이언트가 보낸 apiKey. 여기서 파싱에 실패하면 `INVALID_CATEGORY`. */
  readonly category: string
  readonly dice: readonly number[]
}

/** Java `ScoreConfirmationResult` record 자리. `score`는 **서버가 재계산한** 값이다. */
export interface ScoreConfirmationResult {
  readonly gameId: string
  readonly playerId: string
  readonly roundNumber: number
  readonly category: ScoreCategory
  readonly score: number
  readonly scoreboard: ScoreBoard
}

/**
 * 요청 시그니처 — 멱등 재시도 판정의 유일한 근거다.
 *
 * **주사위 순서에 민감**하다: 같은 라운드에 같은 카테고리·같은 주사위 조합이라도
 * 순서가 다르면 다른 시그니처가 되어 `ROUND_ALREADY_SCORED`로 거부된다.
 * Java와 같은 quirk이고, 그대로 옮긴다(계약).
 */
const requestSignatureOf = (category: ScoreCategory, dice: readonly number[]): string =>
  `${category}:${dice.join(',')}`

const validateCommand = (command: ScoreConfirmationCommand): void => {
  if (command === null || command === undefined) {
    throw new ScoreDomainError('점수 확정 명령은 null일 수 없습니다.')
  }
  if (command.gameId === undefined || command.gameId.trim().length === 0) {
    throw new ScoreDomainError('gameId는 비어 있을 수 없습니다.')
  }
  if (command.playerId === undefined || command.playerId.trim().length === 0) {
    throw new ScoreDomainError('playerId는 비어 있을 수 없습니다.')
  }
  if (command.roundNumber < 1) {
    throw new ScoreDomainError('roundNumber는 1 이상이어야 합니다.')
  }
  if (command.category === undefined || command.category.trim().length === 0) {
    throw new ScoreDomainError('category는 비어 있을 수 없습니다.')
  }
}

/**
 * 점수 확정 — **서버 재계산 + 시그니처**(backend-java `ScoreConfirmationService`).
 *
 * 이 서비스가 지키는 두 가지:
 * 1. 점수는 서버가 만든다. 클라이언트 점수는 와이어에 존재하지도 않으므로
 *    "믿지 않는다"가 아니라 "받지 않는다"에 가깝다(DESIGN.md 원칙 1).
 * 2. 같은 요청의 재시도는 점수를 두 번 더하지 않는다 — 판정은 저장소(Lua)가
 *    하지만, 판정의 입력인 시그니처는 여기서 만든다.
 *
 * 전송 계층을 모른다 — WS·HTTP 타입을 import하지 않는다.
 */
export class ScoreConfirmationService {
  private readonly scoreBoardStore: ScoreBoardStore

  constructor(scoreBoardStore: ScoreBoardStore) {
    this.scoreBoardStore = scoreBoardStore
  }

  async confirm(command: ScoreConfirmationCommand): Promise<ScoreConfirmationResult> {
    validateCommand(command)

    const category = this.categoryOf(command.category)
    const dice = this.diceValues(command.dice)
    let score: number
    try {
      score = calculateScore(category, dice)
    } catch (error) {
      throw new ScoreConfirmationError('INVALID_DICE', messageOf(error), { cause: error })
    }

    const scoreboard = await this.scoreBoardStore.confirmScore(
      command.gameId,
      command.playerId,
      command.roundNumber,
      category,
      score,
      requestSignatureOf(category, dice),
    )
    return {
      gameId: command.gameId,
      playerId: command.playerId,
      roundNumber: command.roundNumber,
      category,
      score,
      scoreboard,
    }
  }

  /**
   * 아직 기록하지 않은 족보 목록. 마감 시각에 서버가 대신 기록할 칸을 고르는
   * 근거다. 열거 순서는 `SCORE_CATEGORIES` 선언 순서로 고정한다 — 랜덤 선택을
   * 재현할 수 있어야 한다.
   */
  async openCategories(gameId: string, playerId: string): Promise<ScoreCategory[]> {
    return openCategoriesOf(await this.scoreBoard(gameId, playerId))
  }

  async scoreBoard(gameId: string, playerId: string): Promise<ScoreBoard> {
    return this.scoreBoardStore.findScoreBoard(gameId, playerId)
  }

  private categoryOf(apiKey: string): ScoreCategory {
    try {
      return scoreCategoryOf(apiKey)
    } catch (error) {
      throw new ScoreConfirmationError('INVALID_CATEGORY', messageOf(error), { cause: error })
    }
  }

  /** 주사위 자체의 유효성은 계산기가 본다. 여기서는 "값이 있는가"만 본다. */
  private diceValues(dice: readonly number[]): readonly number[] {
    if (!Array.isArray(dice) || dice.some((die) => die === null || die === undefined)) {
      throw new ScoreConfirmationError('INVALID_DICE', '주사위는 null을 포함할 수 없습니다.')
    }
    return dice
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
