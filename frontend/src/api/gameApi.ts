import type {
  DiceSet,
  PlayerId,
  RoomSnapshot,
  ScoreBoard,
  YachtCategory,
} from '@/realtime/wsEvents'
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
  roomId: string
  roomCode: string
  you: PlayerId
  nickname: string
  membershipRole: RoomMembershipRole
  sessionToken: string
  snapshot: RoomSnapshot | null
}

export interface SubmitRollRequest {
  dice: DiceSet
}

export interface ScoreCandidates {
  candidates: Record<YachtCategory, number>
}

export interface SubmitScoreRequest {
  category: YachtCategory
  dice: DiceSet
}

export interface ApiCallOptions {
  signal?: AbortSignal
}

export interface GameApiClient {
  createRoom(request: CreateRoomRequest, options?: ApiCallOptions): Promise<RoomSession>
  joinRoom(
    roomCode: string,
    request: JoinRoomRequest,
    options?: ApiCallOptions,
  ): Promise<RoomSession>
  getLobby(roomId: string, options?: ApiCallOptions): Promise<RoomSnapshot>
  getGame(roomId: string, options?: ApiCallOptions): Promise<RoomSnapshot>
  startGame(roomId: string, options?: ApiCallOptions): Promise<RoomSnapshot>
  submitRoll(
    roomId: string,
    request: SubmitRollRequest,
    options?: ApiCallOptions,
  ): Promise<RoomSnapshot>
  getScoreCandidates(roomId: string, options?: ApiCallOptions): Promise<ScoreCandidates>
  submitScore(
    roomId: string,
    request: SubmitScoreRequest,
    options?: ApiCallOptions,
  ): Promise<ScoreBoard>
  getScoreboard(roomId: string, options?: ApiCallOptions): Promise<Record<PlayerId, ScoreBoard>>
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

  getLobby(roomId: string, options?: ApiCallOptions) {
    return apiRequest<RoomSnapshot>(`/rooms/${roomId}/lobby`, requestSignal(options))
  }

  getGame(roomId: string, options?: ApiCallOptions) {
    return apiRequest<RoomSnapshot>(`/rooms/${roomId}/game`, requestSignal(options))
  }

  startGame(roomId: string, options?: ApiCallOptions) {
    return apiRequest<RoomSnapshot>(`/rooms/${roomId}/game`, {
      method: 'POST',
      ...requestSignal(options),
    })
  }

  submitRoll(roomId: string, request: SubmitRollRequest, options?: ApiCallOptions) {
    return apiRequest<RoomSnapshot>(`/rooms/${roomId}/game/rolls`, {
      method: 'POST',
      body: JSON.stringify(request),
      ...requestSignal(options),
    })
  }

  getScoreCandidates(roomId: string, options?: ApiCallOptions) {
    return apiRequest<ScoreCandidates>(`/rooms/${roomId}/scores/candidates`, requestSignal(options))
  }

  submitScore(roomId: string, request: SubmitScoreRequest, options?: ApiCallOptions) {
    return apiRequest<ScoreBoard>(`/rooms/${roomId}/scores`, {
      method: 'POST',
      body: JSON.stringify(request),
      ...requestSignal(options),
    })
  }

  getScoreboard(roomId: string, options?: ApiCallOptions) {
    return apiRequest<Record<PlayerId, ScoreBoard>>(
      `/rooms/${roomId}/scores`,
      requestSignal(options),
    )
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
    roomId: response.room_id,
    roomCode: response.room_id,
    you: response.id,
    nickname: response.nickname,
    membershipRole,
    sessionToken: response.token,
    snapshot: null,
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
