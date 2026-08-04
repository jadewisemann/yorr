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
  /** 파티 모드 대시보드는 플레이어가 아니라 이름을 짓지 않는다 — 비우면 서버가 채운다. */
  nickname?: string
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

/**
 * 이 세션이 방에서 갖는 자리.
 *
 * `host` · `participant` — 둘 다 플레이어다(기존 동작).
 * `dashboard` — 파티 모드에서 방을 연 큰 화면. 게임을 비추고 호스트 권한만 갖되 플레이어가
 * 아니다(서버 플레이어 명단에 없어 턴도 점수판도 없다). 자세한 규약은 백엔드 `RoomMode`.
 */
export type RoomMembershipRole = 'host' | 'participant' | 'dashboard'

/**
 * 이 세션이 <b>지금</b> 방장인가(게임 시작 · 봇 추가 · 대기실 복귀).
 *
 * 방장은 입장 순서가 아니라 **서버 상태**다 — 처음 들어온 사람이 방장이 되고, 방장이 나가면
 * 남은 사람이 이어받는다(백엔드 `RoomValidationService`의 JOIN · LEAVE 규약). 그래서 입장
 * 시점에 굳어 localStorage에 저장되는 `membershipRole`로는 판단할 수 없다 — 승계가 일어나면
 * 그 값은 거짓말이 된다. `state.sync`로 갱신되는 스냅샷의 `hostId`가 유일한 근거다.
 *
 * 파티 모드 대시보드는 플레이어 명단에 없어 `hostId`가 될 수 없으므로 영구히 false다 —
 * 조작은 폰(방장)에서만 한다.
 */
export function isRoomHost(snapshot: RoomSnapshot | null | undefined, you: PlayerId) {
  return Boolean(snapshot?.hostId) && snapshot?.hostId === you
}

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

  /**
   * 파티 모드 방을 연다. 서버는 방만 만들고 이 세션을 플레이어 명단에 넣지 않는다(`?party=true`)
   * — 그래서 이 화면은 대시보드가 되고, 턴 순서·점수판·정원은 QR로 들어올 폰들의 것이 된다.
   * 닉네임을 보내지 않는 이유도 같다: 대시보드는 참가자 목록에 오르지 않는다.
   */
  createPartyRoom(gameCode: GameCode, options?: ApiCallOptions) {
    return enterRoom({}, 'dashboard', options, gameCode, true)
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
  party = false,
) {
  const sessionToken = readAuthSession()?.sessionToken
  const search = new URLSearchParams()
  if (gameCode) search.set('game_code', gameCode)
  // party=true면 서버가 방만 만들고 이 세션을 플레이어 명단에 넣지 않는다(백엔드 RoomMode).
  if (party) search.set('party', 'true')
  const query = search.toString()
  return apiRequest<unknown>(query ? `/rooms?${query}` : '/rooms', {
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
