/**
 * 조회 파이프라인의 공개 표면. 라우트(`http/routes/gameQueries.ts`)와 배선
 * (`server.ts`)은 여기만 import한다 — 내부 파일 경로에 의존하지 않는다.
 *
 * 순위 계산(`calculateGameResult`)은 여기 없다 — 2.7의 `game/completion/index.ts`가
 * 정본이다(같은 계산기를 두 벌 들지 않는다).
 */
export { GameScoreQueryService } from './gameScoreQueryService.js'
export { type ReadOnlyRedis, RedisGameScoreQueryStore } from './gameScoreQueryStore.js'
export {
  GameScoreQueryError,
  type GameScoreQueryReason,
  isGameScoreQueryError,
} from './queryErrors.js'
export { calculateScoreCandidates } from './scoreCandidateService.js'
