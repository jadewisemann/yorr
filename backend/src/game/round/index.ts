/**
 * 라운드 프레임워크의 공개 표면. 2.5(RoundTimerService·RoundTimeoutResolver)
 * 이후의 상위 계층은 여기만 import한다.
 */
export {
  type DeadlineExecutor,
  InMemoryRoundDeadlineScheduler,
  type RoundDeadlineScheduler,
  type RoundDeadlineSchedulerOptions,
  type ScheduledTimeout,
  timerDeadlineExecutor,
} from './deadlineScheduler.js'
export {
  isRoundSyncError,
  RoundSynchronizationError,
  type RoundSyncReason,
} from './roundErrors.js'
export {
  DEFAULT_TOTAL_ROUNDS,
  MAX_ROLL_COUNT,
  type RoundCompletion,
  RoundState,
  type RoundStateProps,
  type RoundSubmissionResult,
} from './roundState.js'
export { InMemoryRoundStateStore, type RoundStateStore } from './roundStateStore.js'
export {
  DICE_COUNT,
  RoundSubmission,
  SUBMITTABLE_CATEGORIES,
  type SubmittableCategory,
} from './roundSubmission.js'
