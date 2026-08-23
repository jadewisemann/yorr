/**
 * 라운드 프레임워크의 공개 표면. 게임 모듈(3.1)·점수(2.6)·게임 종료(2.7)·
 * 재접속 스냅샷(2.8)은 여기만 import한다.
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
  InMemoryRoundDeadlineStore,
  type RoundDeadlineStore,
  type StoredRoundDeadline,
} from './deadlineStore.js'
export {
  isRoundSyncError,
  RoundSynchronizationError,
  type RoundSyncReason,
} from './roundErrors.js'
export type {
  ConfirmedScore,
  DiceHoldPayload,
  DiceRollPayload,
  GameCompletionPort,
  OpenCategoriesPort,
  RoundBroadcaster,
  RoundOutboundEnvelope,
  RoundPresence,
  RoundRoomService,
  RoundRoomSnapshot,
  RoundSubmitPayload,
  ScoreRoundSubmissionOutcome,
  ScoreRoundSubmissionPort,
} from './roundPorts.js'
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
export {
  type DieRoller,
  RoundSynchronizationService,
  type RoundSynchronizationServiceOptions,
  randomDieRoller,
  seededDieRoller,
} from './roundSynchronizationService.js'
export {
  advancedResolution,
  autoRolledResolution,
  type CategoryPicker,
  type RoundTimeoutResolution,
  RoundTimeoutResolver,
  type RoundTimeoutResolverDeps,
  type RoundTimeoutResolverOptions,
  type RoundTimeoutResolverPort,
  staleResolution,
} from './roundTimeoutResolver.js'
export {
  EXPIRY_GRACE_MS,
  MAX_OFFLINE_TURNS,
  ROUND_DURATION_MS,
  type RoundStartedEvent,
  RoundTimerService,
  type RoundTimerServiceDeps,
  type RoundTimerServiceOptions,
  type TurnAdvanceInput,
  UNTIMED_HUMAN_LIMIT,
} from './roundTimerService.js'
