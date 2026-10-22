import type { DiceSet } from '@/realtime/wsEvents'
import type { RoomSession } from '@/room/api/roomApi'

export type MockRealtimeScenario =
  | 'success'
  | 'delay'
  | 'error'
  | 'duplicate'
  | 'out-of-order'
  | 'reconnect'

export type MockSessionRole = 'creator' | 'participant'

export interface RealtimeFixtureOptions {
  role?: MockSessionRole
  scenario?: MockRealtimeScenario
  delayMs?: number
}

/** 메시지 핸들러 묶음이 함께 쓰는 mock 서버 상태. */
export interface RealtimeContext {
  readonly role: MockSessionRole
  readonly scenario: MockRealtimeScenario
  readonly session: RoomSession
  /** 야추 주사위는 mock 서버가 기억한다 — 유지한 눈금이 다음 굴림에 남아야 한다. */
  serverDice: DiceSet
  chatSequence: number
}
