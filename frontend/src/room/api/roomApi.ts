import { readAuthSession } from '@/auth/authSession'
import type { GameState, PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { apiRequest } from '@/shared/api/client'

export interface CreateRoomRequest {
  nickname: string
}

export interface JoinRoomRequest {
  nickname: string
}

export interface EnterRoomRequest {
  nickname: string
  room_id?: string
  /** 로그인했으면 함께 보낸다. 없으면 서버가 새 게스트를 만든다. */
  session_token?: string
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

export interface GameStartResult {
  gameId: string
  snapshot: RoomSnapshot
}

interface ApiCallOptions {
  signal?: AbortSignal
}

interface AuthenticatedApiCallOptions extends ApiCallOptions {
  sessionToken: string
  userId: PlayerId
}

export class HttpRoomApiClient {
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

  leaveRoom(roomCode: string, options: AuthenticatedApiCallOptions) {
    return apiRequest<void>(`/rooms/${roomCode}/players/me`, {
      method: 'DELETE',
      ...requestSignal(options),
      headers: authenticatedHeaders(options),
    })
  }
}

export const roomApiClient = new HttpRoomApiClient()

function enterRoom(
  request: EnterRoomRequest,
  membershipRole: RoomMembershipRole,
  options?: ApiCallOptions,
) {
  // 로그인했다면 그 세션으로 들어가야 이 판의 결과가 계정에 남는다. 보내지 않으면 서버가
  // 새 게스트를 만들고, 전적은 주인 없는 기록이 된다.
  const sessionToken = readAuthSession()?.sessionToken
  return apiRequest<unknown>('/rooms', {
    method: 'POST',
    body: JSON.stringify(sessionToken ? { ...request, session_token: sessionToken } : request),
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
    // REST 초안에는 굴림 진행이 없다. 실제 값은 WS 스냅샷이 채우고, 이 응답은
    // preserveRealtimeGame이 WS 진행을 덮지 않도록 막아준다.
    rollCount: typeof value.rollCount === 'number' ? value.rollCount : 0,
  }
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
