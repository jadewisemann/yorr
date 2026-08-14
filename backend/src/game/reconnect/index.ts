/**
 * 재접속(2.8)의 공개 표면. 야추 모듈(3.1)과 부팅 배선(`server.ts`)은 여기만
 * import한다 — 내부 파일 경로에 의존하지 않는다.
 */
export {
  GameReconnectSnapshotService,
  type GameReconnectSnapshotServiceDeps,
  type ReconnectSnapshot,
} from './gameReconnectSnapshotService.js'
export {
  OrphanedRoundStateSweeper,
  type OrphanedRoundStateSweeperDeps,
  type OrphanedRoundStateSweeperOptions,
  SWEEP_INTERVAL_MS,
  type SweepSchedule,
  type SweepScheduler,
  timerSweepScheduler,
} from './orphanedRoundStateSweeper.js'
export {
  isReconnectSnapshotError,
  ReconnectSnapshotError,
  type ReconnectSnapshotReason,
} from './reconnectErrors.js'
export {
  type OrphanedRoundStatePort,
  type PhasedRoomSnapshot,
  PLAYING_PHASE,
  type RealtimeRoomSnapshotPort,
  type ReconnectRoundState,
  type ReconnectRoundStatePort,
  type RoundDeadlinePort,
  type RoundTimerCancelPort,
  type ScoreboardQueryPort,
  type ScoreboardsByPlayer,
  type SweeperRoomService,
} from './reconnectPorts.js'
export { createYachtDiceState, type YachtDiceState } from './yachtDiceState.js'
