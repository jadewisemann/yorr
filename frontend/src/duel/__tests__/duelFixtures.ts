import type { DuelRound, DuelState } from '@/realtime/wsEvents'

/** 결투 검사들이 함께 쓰는 두 사람. 순서가 곧 `playerOrder`다. */
export const ME = 'me'
export const RIVAL = 'rival'

export function duelState(overrides: Partial<DuelState> = {}): DuelState {
  return {
    fouls: { [ME]: 0, [RIVAL]: 0 },
    hp: { [ME]: 3, [RIVAL]: 3 },
    lastInputSeq: {},
    nextActionAt: 0,
    phase: 'WAITING',
    playerOrder: [ME, RIVAL],
    reactions: {},
    round: 1,
    signalAt: 0,
    version: 1,
    ...overrides,
  }
}

export function duelRound(overrides: Partial<DuelRound> = {}): DuelRound {
  return { at: 0, kind: 'SHOT', number: 1, over: false, ...overrides }
}
