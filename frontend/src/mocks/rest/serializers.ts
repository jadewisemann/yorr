import { HttpResponse } from 'msw'
import type { GameCode } from '@/games'
import type { RoomSnapshot } from '@/realtime/wsEvents'
import type { EnterRoomResponse, RoomSession } from '@/room/api/roomApi'
import { creatorSession, MOCK_ROUND_DURATION_MS, waitingRoomSnapshot } from '../fixtures'

/** mock 스냅샷을 REST 계약 모양으로 옮긴다(프론트 전용 필드는 싣지 않는다). */
export function toRestRoomSnapshot(snapshot: RoomSnapshot) {
  return {
    roomCode: snapshot.roomId,
    gameId: snapshot.phase === 'playing' ? 'mock-game-id' : null,
    hostId: creatorSession.you,
    phase: snapshot.phase === 'waiting' ? 'LOBBY' : snapshot.phase.toUpperCase(),
    capacity: 6,
    players: snapshot.players.map((player) => ({
      playerId: player.playerId,
      nickname: player.nickname,
      score: 0,
      kind: player.kind ?? 'HUMAN',
    })),
    game: snapshot.game
      ? { ...snapshot.game, roundDeadline: Date.now() + MOCK_ROUND_DURATION_MS }
      : null,
  }
}

export function toEnterRoomResponse(
  session: RoomSession,
  nickname: string | undefined,
  gameCode: GameCode,
): EnterRoomResponse {
  return {
    game_code: gameCode,
    id: session.you,
    nickname: nickname?.trim() ? nickname : session.nickname,
    token: session.sessionToken,
    room_id: session.roomId,
  }
}

export function quickMatchUnauthorized(request: Request) {
  const authorized =
    request.headers.get('Authorization')?.startsWith('Bearer ') &&
    Boolean(request.headers.get('X-User-Id'))
  return authorized ? null : HttpResponse.text('unauthorized', { status: 401 })
}

export function mockGameCode(value: string | null): GameCode {
  return value === 'PING_PONG' ? 'PING_PONG' : 'YACHT_DICE'
}

/** 파티방은 참가자 없이 정원 2명(탁구) 또는 6명(야추)으로 연다. */
export function initialRoomSnapshot(party: boolean, gameCode: GameCode): RoomSnapshot {
  if (!party) return { ...waitingRoomSnapshot, gameCode }
  const { hostId: _hostId, ...withoutHost } = waitingRoomSnapshot
  return {
    ...withoutHost,
    gameCode,
    capacity: gameCode === 'PING_PONG' ? 2 : 6,
    players: [],
  }
}
