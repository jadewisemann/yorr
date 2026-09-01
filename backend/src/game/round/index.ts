/**
 * 라운드 프레임워크의 공개 표면. 게임 모듈(3.1)·점수(2.6)·게임 종료(2.7)·
 * 재접속 스냅샷(2.8)은 여기만 import한다.
 */
export {
  type DeadlineExecutor,
  InMemoryRoundDeadlineScheduler,
  type RoundDeadlineScheduler,
  type ScheduledTimeout,
  timerDeadlineExecutor,
} from './deadlineScheduler.js'
export type { RoundDeadlineStore, StoredRoundDeadline } from './deadlineStore.js'
export {
  isRoundSyncError,
  RoundSynchronizationError,
  type RoundSyncReason,
} from './roundErrors.js'
export type {
  DiceHoldPayload,
  DiceRollPayload,
  GameCompletionPort,
  OpenCategoriesPort,
  RoundRoomSnapshot,
  RoundSubmitPayload,
  ScoreRoundSubmissionPort,
} from './roundPorts.js'
export { MAX_ROLL_COUNT, RoundState, type RoundSubmissionResult } from './roundState.js'
export { InMemoryRoundStateStore, type RoundStateStore } from './roundStateStore.js'
export { RoundSubmission, SUBMITTABLE_CATEGORIES } from './roundSubmission.js'
export { RoundSynchronizationService, seededDieRoller } from './roundSynchronizationService.js'
export { RoundTimeoutResolver } from './roundTimeoutResolver.js'
export {
  type RoundStartedEvent,
  RoundTimerService,
  type TurnAdvanceInput,
} from './roundTimerService.js'
