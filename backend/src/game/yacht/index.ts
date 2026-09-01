/**
 * 야추 모듈(3.1)의 공개 표면. 부팅 배선(`server.ts`)과 야추 봇(3.2)은 여기만
 * import한다 — 내부 파일 경로에 의존하지 않는다.
 */

/**
 * 재접속 와이어 타입은 **2.8이 소유한다**(`game/reconnect/yachtDiceState.ts`).
 * 여기서 다시 선언하면 스냅샷 모양이 두 곳으로 갈라지므로 재수출만 한다 —
 * 3.2(봇)와 배선이 야추 배럴 하나만 보고도 쓸 수 있게 하려는 것이다.
 */
/**
 * 봇 스택(3.2)은 `bot/`이 소유한다 — 배선이 배럴 하나만 보고 조립할 수 있게
 * 재수출한다. 내부 파일 경로는 여전히 비공개다.
 */
export {
  BotTurnOrchestrator,
  ExpectimaxYachtBotPolicy,
  LocalYachtBotStrategy,
  ScorecardValueEvaluator,
  YachtBotTurnCoordinator,
} from './bot/index.js'
export { RedisRoundDeadlineStore } from './redisRoundDeadlineStore.js'
export { RedisYachtDiceStateStore } from './redisYachtDiceStateStore.js'
export { YachtDiceGameModule } from './yachtDiceGameModule.js'
export { YachtTurnActionService } from './yachtTurnActionService.js'
