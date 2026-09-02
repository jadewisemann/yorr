import { NORMAL_SPEED } from '../pingPongRules.js'
import type { PingPongBall, PingPongState } from '../pingPongState.js'

/** 탁구 규칙 검사가 함께 쓰는 두 자리. */
export const P1 = 'player-1'
export const P2 = 'player-2'

/**
 * 판이 열려 공이 날아가는 중인 상태. 기본은 0번을 향해(`direction: +1`) 출발점에
 * 놓인 공이고, 검사마다 위치·방향·속도만 덮어쓴다.
 */
export const rallyState = (
  ball: Partial<PingPongBall> = {},
  scores: Record<string, number> = { [P1]: 0, [P2]: 0 },
): PingPongState => ({
  ball: {
    direction: 1,
    faultFrom: 0,
    launchedAt: 1_000,
    pos: 0,
    smash: false,
    speed: NORMAL_SPEED,
    x0: 0.5,
    x1: 0.5,
    ...ball,
  },
  lastInputSeq: { [P1]: -1, [P2]: -1 },
  nextActionAt: 9_000,
  phase: 'PLAYING',
  playerOrder: [P1, P2],
  rally: 0,
  readyPlayerIds: [P1, P2],
  scores,
  serveReceiverId: P1,
  version: 5,
})
