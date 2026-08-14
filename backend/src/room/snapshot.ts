export type RoomPhase = 'LOBBY' | 'PLAYING' | 'FINISHED'

export type ParticipantKind = 'HUMAN' | 'BOT'

export type RoomMode = 'NORMAL' | 'PARTY'

export interface RoomPlayerSnapshot {
  readonly playerId: string
  readonly nickname: string
  readonly score: number
  readonly kind: ParticipantKind
}

/**
 * REST 스냅샷. **WS 스냅샷과 다른 모양이다** — phase가 대문자고, 키가 `roomCode`며,
 * 플레이어에 `score`가 있고 `status`가 없다. 프론트가 두 모양을 각각 파싱하므로
 * 섞으면 안 된다(docs/design/rooms-and-sessions.md).
 */
export interface RoomSnapshot {
  readonly roomCode: string | null
  readonly gameCode: string | null
  readonly gameId: string | null
  readonly hostId: string | null
  readonly phase: RoomPhase | null
  readonly capacity: number
  readonly players: readonly RoomPlayerSnapshot[]
}

/** 없는 방은 404가 아니라 **전 필드 null 스냅샷**이다(`GET /games/{id}`의 계약). */
export const roomNotFound = (roomCode: string | null): RoomSnapshot => ({
  roomCode,
  gameCode: null,
  gameId: null,
  hostId: null,
  phase: null,
  capacity: 0,
  players: [],
})
