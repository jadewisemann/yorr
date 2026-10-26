import type { PlayerId } from '@/realtime/wsEvents'

/**
 * 결투 와이어 메시지. 계약의 정본은 여전히 `@/realtime/wsEvents`이고, 이 파일은
 * 그중 결투 것만 모아 둔 곳이다(wsEvents가 re-export한다).
 */

export type DuelPhase = 'WAITING' | 'SIGNAL' | 'RESULT' | 'FINISHED'
export type DuelRoundKind = 'SHOT' | 'TIE' | 'WARNING' | 'SELF_SHOT' | 'FORFEIT'

export const DUEL_FOUL = -1
export const DUEL_MISS = -2

export interface DuelRound {
  number: number
  kind: DuelRoundKind
  shooterId?: PlayerId | null
  hitId?: PlayerId | null
  koId?: PlayerId | null
  foulId?: PlayerId | null
  over: boolean
  at: number
}

export interface DuelState {
  version: number
  phase: DuelPhase
  playerOrder: PlayerId[]
  hp: Record<PlayerId, number>
  fouls: Record<PlayerId, number>
  reactions: Record<PlayerId, number>
  lastInputSeq: Record<PlayerId, number>
  round: number
  signalAt: number
  nextActionAt: number
  lastRound?: DuelRound | null
}

export interface DuelDrawPayload {
  inputSeq: number
  reactionMs: number
}
