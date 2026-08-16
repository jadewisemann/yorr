/**
 * 결투(3.3)의 공개 표면. 배선(`server.ts`)은 여기만 import한다 — 내부 파일 경로에
 * 의존하지 않는다(2.5·2.7의 배럴과 같은 규칙).
 */
export { DUEL_CODE } from './duelCode.js'
export { DuelGameModule } from './duelGameModule.js'
export {
  type DuelDrawPayload,
  DuelGameService,
  type DuelGameServiceDeps,
  type DuelGameServiceOptions,
  type DuelSnapshot,
  type DuelStartRoster,
} from './duelGameService.js'
export type {
  DuelBroadcaster,
  DuelCompletionPort,
  DuelDeadlineScheduler,
  DuelMarkablePhase,
  DuelOutboundEnvelope,
  DuelPresence,
  DuelRoomSnapshotPort,
  DuelScoreboardPort,
  DuelSessionLookup,
} from './duelPorts.js'
export {
  compareDraw,
  draw,
  expire,
  FOUL,
  FREEZE_MILLIS,
  finish,
  forfeit,
  GRACE_MILLIS,
  hold,
  initialDuelState,
  KO_HOLD_MILLIS,
  MAX_FOULS,
  MAX_HP,
  MAX_WAIT_MILLIS,
  MIN_WAIT_MILLIS,
  MISS,
  nextRound,
  RESULT_HOLD_MILLIS,
  signal,
  TIE_HOLD_MILLIS,
} from './duelRules.js'
export { RedisDuelScoreboard } from './duelScoreboard.js'
export {
  type DuelPhase,
  type DuelPlayerNumbers,
  type DuelRound,
  type DuelRoundKind,
  type DuelState,
  isDuelFinished,
} from './duelState.js'
export {
  DUEL_SCRIPTS,
  type DuelStateStore,
  RedisDuelStateStore,
} from './duelStateStore.js'
