/**
 * 점수 파이프라인의 공개 표면. 게임 종료·조회 REST·야추 모듈은 여기만 import한다
 * — 내부 파일 경로에 의존하지 않는다.
 */
export { createScoreBoard, type ScoreBoard } from './scoreBoard.js'
export { scoreBoardFromHash, TOTAL_FIELD, UPPER_SUBTOTAL_FIELD } from './scoreBoardMapper.js'
export { RedisScoreBoardStore, type ScoreBoardStore } from './scoreBoardStore.js'
export {
  DICE_COUNT,
  isSatisfiedBy,
  isUpperCategory,
  SCORE_CATEGORIES,
  type ScoreCategory,
} from './scoreCategory.js'
export { ScoreConfirmationService } from './scoreConfirmationService.js'
export {
  ScoreConfirmationError,
  type ScoreConfirmationReason,
  ScoreDomainError,
} from './scoreErrors.js'
export { ScoreRoundSubmissionService } from './scoreRoundSubmissionService.js'
export {
  calculateScore,
  UPPER_BONUS_SCORE,
  UPPER_BONUS_THRESHOLD,
} from './yachtScoreCalculator.js'
