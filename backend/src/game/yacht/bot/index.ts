/**
 * 야추 봇 스택(3.2)의 공개 표면. 부팅 배선(`server.ts`)은 여기만 import한다.
 *
 * 조립 순서 = 의존 방향: 평가기 → 정책·폴백 → 코디네이터 → 오케스트레이터.
 * 배선 조각은 docs/design/games/yacht.md 「봇 배선」에 있다.
 */
export { BotDecisionError, BotSearchBudgetError } from './botErrors.js'
export type {
  YachtBotActions,
  YachtBotFallbackStrategy,
  YachtBotPolicy,
  YachtBotRoomService,
  YachtBotRoundLookup,
  YachtBotScoreLookup,
} from './botPorts.js'
export {
  BotTurnOrchestrator,
  type BotTurnOrchestratorDeps,
  type BotTurnOrchestratorOptions,
  HOLD_SELECTION_DELAY_MS,
  ROLL_RESULT_DELAY_MS,
  THROW_DELAY_MS,
  TURN_START_DELAY_MS,
} from './botTurnOrchestrator.js'
export {
  type BotAction,
  type BotDecision,
  DEFAULT_SEARCH_BUDGET_MS,
  ExpectimaxYachtBotPolicy,
  type ExpectimaxYachtBotPolicyOptions,
  holdDecision,
  scoreDecision,
} from './expectimaxYachtBotPolicy.js'
export { LocalYachtBotStrategy } from './localYachtBotStrategy.js'
export { ScorecardValueEvaluator } from './scorecardValueEvaluator.js'
export {
  type BotTurnStep,
  YachtBotTurnCoordinator,
  type YachtBotTurnCoordinatorDeps,
  type YachtBotTurnCoordinatorOptions,
} from './yachtBotTurnCoordinator.js'
