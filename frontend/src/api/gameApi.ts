import type {
  DiceSet,
  PlayerId,
  RoomSnapshot,
  ScoreBoard,
  YachtCategory,
} from '@/realtime/wsEvents'
import { apiRequest } from './client'

export interface CreateRoomRequest {
  mode: 'party' | 'online'
  gameType: 'yacht'
}

export interface JoinRoomRequest {
  nickname: string
}

export interface RoomSession {
  roomId: string
  roomCode: string
  you: PlayerId
  sessionToken: string
  snapshot: RoomSnapshot
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
  joinRoom(roomId: string, request: JoinRoomRequest, options?: ApiCallOptions): Promise<RoomSession>
  getLobby(roomId: string, options?: ApiCallOptions): Promise<RoomSnapshot>
  getGame(roomId: string, options?: ApiCallOptions): Promise<RoomSnapshot>
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
    return apiRequest<RoomSession>('/rooms', {
      method: 'POST',
      body: JSON.stringify(request),
      ...requestSignal(options),
    })
  }

  joinRoom(roomId: string, request: JoinRoomRequest, options?: ApiCallOptions) {
    return apiRequest<RoomSession>(`/rooms/${roomId}/participants`, {
      method: 'POST',
      body: JSON.stringify(request),
      ...requestSignal(options),
    })
  }

  getLobby(roomId: string, options?: ApiCallOptions) {
    return apiRequest<RoomSnapshot>(`/rooms/${roomId}/lobby`, requestSignal(options))
  }

  getGame(roomId: string, options?: ApiCallOptions) {
    return apiRequest<RoomSnapshot>(`/rooms/${roomId}/game`, requestSignal(options))
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

function requestSignal(options?: ApiCallOptions): Pick<RequestInit, 'signal'> | undefined {
  return options?.signal ? { signal: options.signal } : undefined
}
