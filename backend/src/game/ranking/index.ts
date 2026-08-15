/**
 * 주간 랭킹의 공개 표면. 조립 순서가 곧 의존 방향이다:
 * `MysqlWeeklyRankingStore` → `CachingWeeklyRankingRepository` → `WeeklyRankingService`.
 * 캐시를 빼먹으면 조용히 느려지기만 하고, 전적 보관이 `evictAll()`을 부를 대상이
 * 사라진다 — 배선은 `server.ts`가 한다(persistence.md 「캐시」).
 */
export { CachingWeeklyRankingRepository } from './weeklyRankingCache.js'
export { weeklyRankingResponse } from './weeklyRankingResponse.js'
export { MAX_LIMIT, WeeklyRankingService } from './weeklyRankingService.js'
export {
  MysqlWeeklyRankingStore,
  type WeeklyBest,
  type WeeklyRankingRepository,
} from './weeklyRankingStore.js'
