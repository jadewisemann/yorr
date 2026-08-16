/**
 * 게임 종료의 공개 표면. 배선(`server.ts`)·조회 REST(2.9)·게임 모듈(3.1)·
 * 전적 보관(4.4)은 여기만 import한다 — 내부 파일 경로에 의존하지 않는다.
 */
export {
  type CompletionBroadcaster,
  type CompletionDeadlineScheduler,
  type CompletionOutboundEnvelope,
  type CompletionPhase,
  type CompletionPlayerSnapshot,
  type CompletionPresence,
  type CompletionRoomService,
  type CompletionRoomSnapshot,
  type CompletionSnapshotService,
  type MatchArchivePort,
  noopMatchArchive,
} from './completionPorts.js'
export {
  type GameCompletionStore,
  REQUIRED_CATEGORIES,
  RedisGameCompletionStore,
} from './completionStore.js'
export {
  GameCompletionService,
  type GameCompletionServiceDeps,
  type GameCompletionServiceOptions,
  type GameFinishedEvent,
} from './gameCompletionService.js'
export {
  calculateGameResult,
  GameCompletionDomainError,
  type GameResult,
  type PlayerFinalScore,
  type PlayerResult,
  type Ranking,
  rankTotals,
} from './gameResultCalculator.js'
export {
  COMPLETION_SCRIPTS,
  FINISH_IF_COMPLETE,
  FINISH_IF_COMPLETE_CODE,
} from './scripts.js'
