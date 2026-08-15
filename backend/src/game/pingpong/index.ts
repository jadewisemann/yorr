/**
 * 탁구 모듈의 공개 표면. 부팅 배선(`server.ts`)과 AI 결과 REST 라우트는 여기만
 * import한다 — 내부 파일 경로에 의존하지 않는다.
 *
 * AI 결과는 멀티플레이 파이프라인과 무관한 로컬 싱글플레이 보고이므로 게임 상태·
 * 스토어·모듈을 건드리지 않는다(docs/design/games/pingpong.md).
 */
export {
  AI_PLAYER_ID,
  GUEST_NICKNAME,
  type PingPongAiResultArchive,
  PingPongAiResultService,
} from './aiResultService.js'
export { PingPongGameModule } from './pingPongGameModule.js'
export { PingPongGameService } from './pingPongGameService.js'
export { redisPingPongScoreWriter } from './pingPongScoreWriter.js'
export { RedisPingPongStateStore } from './pingPongStateStore.js'
