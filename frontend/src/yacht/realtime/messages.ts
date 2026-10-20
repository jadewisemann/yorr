import type { GameState, PlayerId, ScoreBoard } from '@/realtime/wsEvents'
import type { DiceSet } from '@/yacht/domain/dice'
import type { YachtCategory } from '@/yacht/domain/scoring'

/**
 * 야추 와이어 메시지. 계약의 정본은 여전히 `@/realtime/wsEvents`이고, 이 파일은
 * 그중 야추 것만 모아 둔 곳이다(wsEvents가 re-export한다).
 */

export interface RoundStartPayload {
  roundNumber: number
  /** epoch ms. null이면 이 턴에는 제한 시간이 없다(`GameState.roundDeadline` 참고). */
  deadline: number | null
  activePlayerId: PlayerId
  turnOrder: PlayerId[]
}
export interface RoundSubmitPayload {
  roundNumber: number
  dice: DiceSet
  category: YachtCategory
}
export interface RoundEndPayload {
  roundNumber: number
  submitted: PlayerId[]
}
export interface DiceRollPayload {
  roundNumber: number
  rollCount: 1 | 2 | 3
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
export interface DiceHoldPayload {
  roundNumber: number
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
export interface DiceHoldChangedPayload {
  playerId: PlayerId
  roundNumber: number
  held: readonly [boolean, boolean, boolean, boolean, boolean]
}
export interface DiceShakePayload {
  roundNumber: number
  direction: 'left' | 'right'
  strength: number
}
export interface DiceShakenPayload {
  playerId: PlayerId
  roundNumber: number
  direction: 'left' | 'right'
  strength: number
}
export interface DiceThrowPayload {
  roundNumber: number
  rollCount: 1 | 2 | 3
}
export interface DiceThrownPayload {
  playerId: PlayerId
  roundNumber: number
  rollCount: 1 | 2 | 3
}
export interface DiceBroadcastPayload {
  playerId: PlayerId
  roundNumber: number
  rollCount: 1 | 2 | 3
  dice: DiceSet
  held: readonly [boolean, boolean, boolean, boolean, boolean]
  auto?: boolean
}
export interface ScoreUpdatePayload {
  playerId: PlayerId
  scoreboard: ScoreBoard
}
export interface GameOverPayload {
  rankings: Array<{ rank: number; playerId: PlayerId; total: number }>
}
export interface StatePatchPayload {
  changes: Partial<GameState>
}
