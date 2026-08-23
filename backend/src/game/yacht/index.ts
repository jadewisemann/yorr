/**
 * 야추 모듈(3.1)의 공개 표면. 부팅 배선(`server.ts`)과 야추 봇(3.2)은 여기만
 * import한다 — 내부 파일 경로에 의존하지 않는다.
 */

/**
 * 재접속 와이어 타입은 **2.8이 소유한다**(`game/reconnect/yachtDiceState.ts`).
 * 여기서 다시 선언하면 스냅샷 모양이 두 곳으로 갈라지므로 재수출만 한다 —
 * 3.2(봇)와 배선이 야추 배럴 하나만 보고도 쓸 수 있게 하려는 것이다.
 */
export { createYachtDiceState, type YachtDiceState } from '../reconnect/index.js'
/**
 * 봇 스택(3.2)은 `bot/`이 소유한다 — 배선이 배럴 하나만 보고 조립할 수 있게
 * 재수출한다. 내부 파일 경로는 여전히 비공개다.
 */
export {
  BotDecisionError,
  BotSearchBudgetError,
  BotTurnOrchestrator,
  type BotTurnOrchestratorDeps,
  type BotTurnOrchestratorOptions,
  type BotTurnStep,
  DEFAULT_SEARCH_BUDGET_MS,
  ExpectimaxYachtBotPolicy,
  type ExpectimaxYachtBotPolicyOptions,
  HOLD_SELECTION_DELAY_MS,
  LocalYachtBotStrategy,
  ROLL_RESULT_DELAY_MS,
  ScorecardValueEvaluator,
  THROW_DELAY_MS,
  TURN_START_DELAY_MS,
  type YachtBotActions,
  type YachtBotFallbackStrategy,
  type YachtBotPolicy,
  type YachtBotRoomService,
  type YachtBotRoundLookup,
  type YachtBotScoreLookup,
  YachtBotTurnCoordinator,
  type YachtBotTurnCoordinatorDeps,
  type YachtBotTurnCoordinatorOptions,
} from './bot/index.js'
export {
  type DiceShakeRequest,
  type DiceThrowRequest,
  diceHoldPayloadSchema,
  diceRollPayloadSchema,
  diceShakePayloadSchema,
  diceThrowPayloadSchema,
  roundSubmitPayloadSchema,
  toDiceHoldPayload,
  toDiceRollPayload,
  toDiceShakeRequest,
  toDiceThrowRequest,
  toRoundSubmitPayload,
} from './payloads.js'
export { RedisRoundDeadlineStore } from './redisRoundDeadlineStore.js'
export {
  LOCK_RETRY_MS,
  LOCK_TTL_MS,
  LOCK_WAIT_MS,
  RedisYachtDiceStateStore,
  type RedisYachtDiceStateStoreOptions,
} from './redisYachtDiceStateStore.js'
export { YACHT_SCRIPTS, YACHT_UNLOCK_STATE } from './scripts.js'
export {
  YachtDiceGameModule,
  type YachtDiceGameModuleDeps,
  type YachtDiceGameModuleOptions,
} from './yachtDiceGameModule.js'
export {
  deserializeState,
  serializeState,
  toStateSnapshot,
  type YachtDiceStateSnapshot,
  type YachtSubmissionSnapshot,
} from './yachtDiceStateSnapshot.js'
export type {
  YachtBroadcaster,
  YachtClientSocket,
  YachtOutboundEnvelope,
  YachtRealtimeSnapshots,
  YachtReconnectSnapshots,
  YachtRoomPhase,
  YachtRoundService,
  YachtRoundTimer,
  YachtScoreSubmission,
  YachtSeatRegistry,
} from './yachtPorts.js'
export {
  YachtTurnActionService,
  type YachtTurnActionServiceDeps,
  type YachtTurnActionServiceOptions,
} from './yachtTurnActionService.js'
export {
  isYachtInboundEvent,
  YACHT_INBOUND_EVENTS,
  type YachtInboundEvent,
  yachtWsType,
} from './yachtWsTypes.js'
