import type { DiceSet, GameState, PlayerId, RoomSnapshot, YachtCategory } from '@/realtime/wsEvents'
import { apiRequest } from './client'

export interface CreateRoomRequest {
  nickname: string
}

export interface JoinRoomRequest {
  nickname: string
}

export interface EnterRoomRequest {
  nickname: string
  room_id?: string
}

export interface EnterRoomResponse {
  id: string
  nickname: string
  token: string
  room_id: string
}

export type RoomMembershipRole = 'host' | 'participant'

export interface RoomSession {
  gameId: string | null
  roomId: string
  roomCode: string
  you: PlayerId
  nickname: string
  membershipRole: RoomMembershipRole
  sessionToken: string
  snapshot: RoomSnapshot | null
}

export interface ScoreCandidatesRequest {
  dice: DiceSet
}

export interface ScoreCandidates {
  candidates: Record<YachtCategory, number>
}

export interface GameStartResult {
  gameId: string
  snapshot: RoomSnapshot
}

export interface ApiCallOptions {
  signal?: AbortSignal
}

export interface AuthenticatedApiCallOptions extends ApiCallOptions {
  sessionToken: string
  userId: PlayerId
}

export interface GameApiClient {
  createRoom(request: CreateRoomRequest, options?: ApiCallOptions): Promise<RoomSession>
  joinRoom(
    roomCode: string,
    request: JoinRoomRequest,
    options?: ApiCallOptions,
  ): Promise<RoomSession>
  getGame(gameId: string, options?: ApiCallOptions): Promise<RoomSnapshot>
  startGame(roomCode: string, options: AuthenticatedApiCallOptions): Promise<GameStartResult>
  /** 종료된 게임을 대기실로 되돌린다(host 전용). 방 전원이 함께 이동한다. */
  returnToLobby(roomCode: string, options: AuthenticatedApiCallOptions): Promise<void>
  getScoreCandidates(
    gameId: string,
    request: ScoreCandidatesRequest,
    options?: ApiCallOptions,
  ): Promise<ScoreCandidates>
  leaveRoom(roomCode: string, options: AuthenticatedApiCallOptions): Promise<void>
}

export class HttpGameApiClient implements GameApiClient {
  createRoom(request: CreateRoomRequest, options?: ApiCallOptions) {
    return enterRoom({ nickname: request.nickname }, 'host', options)
  }

  joinRoom(roomCode: string, request: JoinRoomRequest, options?: ApiCallOptions) {
    return enterRoom(
      {
        nickname: request.nickname,
        room_id: roomCode,
      },
      'participant',
      options,
    )
  }

  getGame(gameId: string, options?: ApiCallOptions) {
    return apiRequest<unknown>(`/games/${gameId}`, requestSignal(options)).then(toRoomSnapshot)
  }

  startGame(roomCode: string, options: AuthenticatedApiCallOptions) {
    return apiRequest<unknown>(`/rooms/${roomCode}/games`, {
      method: 'POST',
      ...requestSignal(options),
      headers: authenticatedHeaders(options),
    }).then(toGameStartResult)
  }

  returnToLobby(roomCode: string, options: AuthenticatedApiCallOptions) {
    return apiRequest<void>(`/rooms/${roomCode}/lobby`, {
      method: 'POST',
      ...requestSignal(options),
      headers: authenticatedHeaders(options),
    })
  }

  getScoreCandidates(gameId: string, request: ScoreCandidatesRequest, options?: ApiCallOptions) {
    return apiRequest<unknown>(`/games/${gameId}/score-candidates`, {
      method: 'POST',
      body: JSON.stringify(request),
      ...requestSignal(options),
    }).then(toScoreCandidates)
  }

  leaveRoom(roomCode: string, options: AuthenticatedApiCallOptions) {
    return apiRequest<void>(`/rooms/${roomCode}/players/me`, {
      method: 'DELETE',
      ...requestSignal(options),
      headers: authenticatedHeaders(options),
    })
  }
}

export const gameApiClient: GameApiClient = new HttpGameApiClient()

function enterRoom(
  request: EnterRoomRequest,
  membershipRole: RoomMembershipRole,
  options?: ApiCallOptions,
) {
  return apiRequest<unknown>('/rooms', {
    method: 'POST',
    body: JSON.stringify(request),
    ...requestSignal(options),
  }).then((response) => toRoomSession(response, membershipRole))
}

function toRoomSession(response: unknown, membershipRole: RoomMembershipRole): RoomSession {
  if (
    !isRecord(response) ||
    !isNonEmptyString(response.id) ||
    !isNonEmptyString(response.nickname) ||
    !isNonEmptyString(response.token) ||
    !isNonEmptyString(response.room_id)
  ) {
    throw new Error('Invalid enter room response')
  }

  return {
    gameId: null,
    roomId: response.room_id,
    roomCode: response.room_id,
    you: response.id,
    nickname: response.nickname,
    membershipRole,
    sessionToken: response.token,
    snapshot: null,
  }
}

function toGameStartResult(response: unknown): GameStartResult {
  if (!isRecord(response) || !isNonEmptyString(response.gameId)) {
    throw new Error('Invalid game start response')
  }

  return {
    gameId: response.gameId,
    snapshot: toRoomSnapshot(response.snapshot),
  }
}

function toRoomSnapshot(response: unknown): RoomSnapshot {
  if (!isRecord(response)) {
    throw new Error('Invalid room snapshot response')
  }

  const phase = toRoomPhase(response.phase)

  if (
    !isNonEmptyString(response.roomCode) ||
    phase === undefined ||
    !Array.isArray(response.players) ||
    !response.players.every(isRestRoomPlayer)
  ) {
    throw new Error('Invalid room snapshot response')
  }

  const game = toGameState(response.game)

  return {
    roomId: response.roomCode,
    phase,
    players: response.players.map((player) => ({
      playerId: player.playerId,
      nickname: player.nickname,
      status: 'online',
    })),
    ...(game ? { game } : {}),
  }
}

/**
 * REST 스냅샷의 진행 상태. 계약 초안(realtime-and-api.md)의 선택 필드라
 * 없거나 형태가 다르면 조용히 무시한다 — 진행 상태의 SSOT는 WS(state.sync·round.start)다.
 */
function toGameState(value: unknown): GameState | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.activePlayerId) ||
    typeof value.roundNumber !== 'number' ||
    typeof value.roundDeadline !== 'number' ||
    !isRecord(value.scores)
  ) {
    return undefined
  }

  return {
    activePlayerId: value.activePlayerId,
    roundNumber: value.roundNumber,
    roundDeadline: value.roundDeadline,
    scores: value.scores as GameState['scores'],
  }
}

function toScoreCandidates(response: unknown): ScoreCandidates {
  if (!isRecord(response) || !isRecord(response.candidates)) {
    throw new Error('Invalid score candidates response')
  }

  const entries = Object.entries(response.candidates)
  if (!entries.every(([, score]) => typeof score === 'number' && Number.isInteger(score))) {
    throw new Error('Invalid score candidates response')
  }

  return { candidates: Object.fromEntries(entries) as Record<YachtCategory, number> }
}

function isRestRoomPlayer(value: unknown): value is { nickname: string; playerId: string } {
  return isRecord(value) && isNonEmptyString(value.playerId) && isNonEmptyString(value.nickname)
}

function toRoomPhase(value: unknown): RoomSnapshot['phase'] | undefined {
  if (value === 'LOBBY') return 'waiting'
  if (value === 'PLAYING') return 'playing'
  if (value === 'FINISHED') return 'finished'
  return undefined
}

function authenticatedHeaders(options: AuthenticatedApiCallOptions) {
  return {
    Authorization: `Bearer ${options.sessionToken}`,
    'X-User-Id': options.userId,
  }
}

function requestSignal(options?: ApiCallOptions): Pick<RequestInit, 'signal'> | undefined {
  return options?.signal ? { signal: options.signal } : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
