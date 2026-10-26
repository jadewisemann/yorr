import type { PlayerId } from '@/realtime/wsEvents'

/**
 * 탁구 와이어 메시지. 계약의 정본은 여전히 `@/realtime/wsEvents`이고, 이 파일은
 * 그중 탁구 것만 모아 둔 곳이다(wsEvents가 re-export한다).
 */

export type PingPongPhase = 'PREPARING' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED'
export type PingPongFault = 'OUT' | 'NET'
export type PingPongEventType =
  | 'READY'
  | 'PRACTICE'
  | 'PLAYER_READY'
  | 'SERVE'
  | 'TOO_EARLY'
  | 'TOO_LATE'
  | 'OK'
  | 'NICE'
  | 'SMASH'
  | 'OUT'
  | 'NET'
  | 'POINT'
  | 'GAME_OVER'
  | 'OPPONENT_LEFT'

export interface PingPongBallState {
  pos: number
  direction: 1 | -1
  speed: number
  smash: boolean
  fault?: PingPongFault | null
  faultFrom: number
  x0: number
  x1: number
  launchedAt: number
}

export interface PingPongEvent {
  id: number
  type: PingPongEventType
  playerId?: PlayerId | null
  at: number
}

export interface PingPongState {
  version: number
  phase: PingPongPhase
  playerOrder: PlayerId[]
  scores: Record<PlayerId, number>
  lastInputSeq: Record<PlayerId, number>
  readyPlayerIds: PlayerId[]
  ball: PingPongBallState
  rally: number
  serveReceiverId?: PlayerId | null
  nextActionAt: number
  lastEvent?: PingPongEvent | null
}

export interface PingPongSwingPayload {
  inputSeq: number
  clientTs: number
}

export type PingPongReadyPayload = Record<string, never>

/**
 * C→S: **파티 모드에서 대시보드가 판정한 상태**(ADR-0003). 서버는 랠리를 다시 계산하지
 * 않고 검증만 한 뒤 방에 `game.ping_pong.state`로 뿌리고, `FINISHED`면 보고된 점수로
 * 완료 경로를 탄다.
 *
 * 서버가 보는 것 넷: 보낸 사람이 플레이어가 **아닐 것**(대시보드는 명단에 없다),
 * `version`이 증가할 것, `playerOrder`가 서버 것과 같을 것, 끝난 판이 아닐 것.
 * 그 밖의 판정은 하지 않는다 — 그것이 이 계약의 뜻이다.
 */
export type PingPongHostStatePayload = PingPongState

/**
 * S→C: 링크가 없는 폰의 스윙을 **대시보드에게 전달**하는 방송. 파티 모드에서만 나간다.
 *
 * 방 전체 방송인 이유는 서버가 대시보드를 특정하지 않기 때문이고, 컨트롤러는 이 메시지를
 * 무시하면 된다. 이것이 있어야 **링크가 없어도 파티 탁구가 성립한다**(ADR-0003).
 */
export interface PingPongSwungPayload {
  playerId: PlayerId
  inputSeq: number
  clientTs: number
}
