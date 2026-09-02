import type { PingPongState } from '@/realtime/wsEvents'

/** 파티 모드 검사들이 함께 쓰는 두 사람. `playerOrder`의 순서가 로컬 1·2번을 정한다. */
export const P1 = 'player-1'
export const P2 = 'player-2'

export function pingPongState(overrides: Partial<PingPongState> = {}): PingPongState {
  return {
    ball: {
      direction: 1,
      faultFrom: 0,
      launchedAt: 0,
      pos: 0.5,
      smash: false,
      speed: 1,
      x0: 0.5,
      x1: 0.5,
    },
    lastInputSeq: { [P1]: 3, [P2]: 5 },
    nextActionAt: 0,
    phase: 'COUNTDOWN',
    playerOrder: [P1, P2],
    rally: 0,
    readyPlayerIds: [P1, P2],
    scores: { [P1]: 0, [P2]: 0 },
    version: 4,
    ...overrides,
  }
}
