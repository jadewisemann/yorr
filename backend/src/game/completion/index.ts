/**
 * 게임 종료의 공개 표면. 배선(`server.ts`)·조회 REST·게임 모듈·전적 보관은
 * 여기만 import한다 — 내부 파일 경로에 의존하지 않는다.
 */
export type { CompletionRoomSnapshot, MatchArchivePort } from './completionPorts.js'
export { RedisGameCompletionStore } from './completionStore.js'
export { GameCompletionService } from './gameCompletionService.js'
export { calculateGameResult, type GameResult, type Ranking } from './gameResultCalculator.js'
