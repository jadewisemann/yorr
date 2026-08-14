/**
 * 점수 파이프라인의 공개 표면. 2.7(게임 종료)·2.9(조회 REST)·3.1(야추 모듈)은
 * 여기만 import한다 — 내부 파일 경로에 의존하지 않는다.
 */
export {
  categoryScoreMap,
  createScoreBoard,
  emptyScoreBoard,
  openCategoriesOf,
  type ScoreBoard,
  type ScoreBoardCategories,
} from './scoreBoard.js'
export {
  scoreBoardFromHash,
  TOTAL_FIELD,
  UPPER_BONUS_FIELD,
  UPPER_SUBTOTAL_FIELD,
} from './scoreBoardMapper.js'
export {
  RedisScoreBoardStore,
  type ScoreBoardStore,
} from './scoreBoardStore.js'
export {
  DICE_COUNT,
  isSatisfiedBy,
  isScoreCategory,
  isUpperCategory,
  SCORE_CATEGORIES,
  SCORE_CATEGORY_INFO,
  type ScoreCategory,
  type ScoreCategoryInfo,
  scoreCategoryOf,
  UPPER_CATEGORIES,
  type UpperScoreCategory,
  validateDice,
} from './scoreCategory.js'
export {
  requestSignatureOf,
  type ScoreConfirmationCommand,
  type ScoreConfirmationResult,
  ScoreConfirmationService,
} from './scoreConfirmationService.js'
export {
  isScoreConfirmationError,
  ScoreConfirmationError,
  type ScoreConfirmationReason,
  ScoreDomainError,
} from './scoreErrors.js'
export {
  type CurrentGameLookup,
  type RoundSubmitPayloadLike,
  type RoundSubmitPort,
  type ScoreRoundSubmissionResult,
  ScoreRoundSubmissionService,
} from './scoreRoundSubmissionService.js'
export { CONFIRM_SCORE, CONFIRM_SCORE_CODE, SCORE_SCRIPTS } from './scripts.js'
export {
  calculateScore,
  calculateUpperBonus,
  calculateUpperSubtotal,
  UPPER_BONUS_SCORE,
  UPPER_BONUS_THRESHOLD,
} from './yachtScoreCalculator.js'
