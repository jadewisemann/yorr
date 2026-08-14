/**
 * 탁구(3.4 + 4.6)의 공개 표면. 부팅 배선(`server.ts`)과 AI 결과 REST 라우트는
 * 여기만 import한다 — 내부 파일 경로에 의존하지 않는다.
 *
 * **4.6이 3.4에서 쓴 것은 `WIN_SCORE` 하나다**(11점·2점차 종료 조건 재검증). AI
 * 결과는 멀티플레이 파이프라인과 무관한 로컬 싱글플레이 보고이므로 게임 상태·
 * 스토어·모듈을 건드리지 않는다(docs/design/games/pingpong.md).
 */
export {
  AI_NICKNAME,
  AI_PLAYER_ID,
  bindPingPongAiResult,
  GUEST_NICKNAME,
  LOCAL_AI_ROOM_CODE,
  type PingPongAiPlayer,
  type PingPongAiResultArchive,
  type PingPongAiResultBinding,
  type PingPongAiResultRequest,
  PingPongAiResultService,
} from './aiResultService.js'
export {
  PingPongGameModule,
  type PingPongSocketMembership,
} from './pingPongGameModule.js'
export {
  PingPongGameService,
  type PingPongGameServiceDeps,
  type PingPongGameServiceOptions,
  type PingPongGameStart,
  TARGET_X_MAX,
  TARGET_X_MIN,
} from './pingPongGameService.js'
export type {
  PingPongBroadcaster,
  PingPongCompletionPort,
  PingPongDeadlineScheduler,
  PingPongOutboundEnvelope,
  PingPongPhaseMark,
  PingPongPresence,
  PingPongRoomService,
  PingPongScoreWriter,
  PingPongSnapshotService,
  PingPongStateStore,
} from './pingPongPorts.js'
export {
  ballAt,
  expire,
  forfeit,
  initial,
  judgedAt,
  MAX_ROLLBACK_MILLIS,
  NORMAL_SPEED,
  POINT_COUNTDOWN_MILLIS,
  ready,
  SMASH_SPEED,
  serve,
  serveReceiver,
  swing,
  WEAK_SPEED,
  WIN_SCORE,
} from './pingPongRules.js'
export { redisPingPongScoreWriter } from './pingPongScoreWriter.js'
export {
  isPingPongFinished,
  type PingPongBall,
  type PingPongDirection,
  type PingPongEvent,
  type PingPongEventType,
  type PingPongFault,
  type PingPongPhase,
  type PingPongPlayerNumbers,
  type PingPongState,
  type PingPongSwingPayload,
} from './pingPongState.js'
export {
  PING_PONG_STATE_SCRIPTS,
  RedisPingPongStateStore,
} from './pingPongStateStore.js'
