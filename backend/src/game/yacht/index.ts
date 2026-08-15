/**
 * 야추 모듈의 공개 표면. 부팅 배선(`server.ts`)은 여기만 import한다 — 내부 파일
 * 경로에 의존하지 않는다. 봇 스택은 `bot/`이 소유하며 여기서 재수출만 한다.
 */
export {
  BotTurnOrchestrator,
  ExpectimaxYachtBotPolicy,
  LocalYachtBotStrategy,
  ScorecardValueEvaluator,
  YachtBotTurnCoordinator,
} from './bot/index.js'
export { RedisYachtDiceStateStore } from './redisYachtDiceStateStore.js'
export { YachtDiceGameModule } from './yachtDiceGameModule.js'
export { YachtTurnActionService } from './yachtTurnActionService.js'
