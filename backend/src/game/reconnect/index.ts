/**
 * 재접속(2.8)의 공개 표면. 야추 모듈(3.1)과 부팅 배선(`server.ts`)은 여기만
 * import한다 — 내부 파일 경로에 의존하지 않는다.
 */
export { GameReconnectSnapshotService } from './gameReconnectSnapshotService.js'
export {
  OrphanedRoundStateSweeper,
  SWEEP_INTERVAL_MS,
  type SweepSchedule,
  type SweepScheduler,
} from './orphanedRoundStateSweeper.js'
