import { readAuthSession } from '@/auth/authSession'
import type { GameCode } from '@/games'
import type {
  DiceSet,
  GameState,
  ParticipantKind,
  PlayerId,
  RoomSnapshot,
  YachtCategory,
} from '@/realtime/wsEvents'
import { apiRequest } from '@/shared/api/client'

export interface CreateRoomRequest {
  gameCode?: GameCode
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
  game_code?: GameCode
  id: string
  nickname: string
  token: string
  room_id: string
}

export type RoomMembershipRole = 'host' | 'participant'

export interface RoomSession {
  gameCode?: GameCode
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

export class HttpRoomApiClient {
  createRoom(request: CreateRoomRequest, options?: ApiCallOptions) {
    return enterRoom(
      { nickname: request.nickname },
      'host',
      options,
      request.gameCode ?? 'YACHT_DICE',
    )
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

  addBot(roomCode: string, options: AuthenticatedApiCallOptions) {
    return apiRequest<unknown>(`/rooms/${roomCode}/bots`, {
      method: 'POST',
      ...requestSignal(options),
      headers: authenticatedHeaders(options),
    }).then(toRoomSnapshot)
  }

  removeBot(roomCode: string, botId: PlayerId, options: AuthenticatedApiCallOptions) {
    return apiRequest<unknown>(`/rooms/${roomCode}/bots/${botId}`, {
      method: 'DELETE',
      ...requestSignal(options),
      headers: authenticatedHeaders(options),
    }).then(toRoomSnapshot)
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

export const roomApiClient = new HttpRoomApiClient()

function enterRoom(
  request: EnterRoomRequest,
  membershipRole: RoomMembershipRole,
  options?: ApiCallOptions,
  gameCode?: GameCode,
) {
  const sessionToken = readAuthSession()?.sessionToken
  const path = gameCode ? `/rooms?game_code=${encodeURIComponent(gameCode)}` : '/rooms'
  return apiRequest<unknown>(path, {
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
    ...(isGameCode(response.game_code) ? { gameCode: response.game_code } : {}),
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
    ...(isGameCode(response.gameCode) ? { gameCode: response.gameCode } : {}),
    phase,
    players: response.players.map((player) => ({
      playerId: player.playerId,
      nickname: player.nickname,
      status: 'online',
      kind: player.kind ?? 'HUMAN',
      ...(isNonEmptyString(response.hostId) ? { isHost: player.playerId === response.hostId } : {}),
    })),
    ...(isNonEmptyString(response.hostId) ? { hostId: response.hostId } : {}),
    ...(typeof response.capacity === 'number' ? { capacity: response.capacity } : {}),
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

function isRestRoomPlayer(value: unknown): value is {
  nickname: string
  playerId: string
  kind?: ParticipantKind
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.playerId) &&
    isNonEmptyString(value.nickname) &&
    (value.kind === undefined || isParticipantKind(value.kind))
  )
}

function isParticipantKind(value: unknown): value is ParticipantKind {
  return value === 'HUMAN' || value === 'BOT'
}

function isGameCode(value: unknown): value is GameCode {
  return value === 'YACHT_DICE' || value === 'PING_PONG'
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
