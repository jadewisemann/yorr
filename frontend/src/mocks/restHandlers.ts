import { delay, HttpResponse, http } from 'msw'
import type { GameCode } from '@/games'
import type { Player, RoomSnapshot } from '@/realtime/wsEvents'
import type {
  EnterRoomRequest,
  EnterRoomResponse,
  RoomSession,
  ScoreCandidatesRequest,
} from '@/room/api/roomApi'
import { calculateScoreCandidates } from '@/yacht/domain/scoring'
import {
  createPlayingRoomSnapshot,
  creatorSession,
  dashboardSession,
  MOCK_ROOM_ID,
  MOCK_ROUND_DURATION_MS,
  participantSession,
  playingRoomSnapshot,
  waitingRoomSnapshot,
} from './fixtures'
import { clearMockRoomSnapshot, loadMockRoomSnapshot, saveMockRoomSnapshot } from './mockRoomState'

export type MockRestScenario = 'success' | 'delay' | 'error'

export interface RestHandlerOptions {
  scenario?: MockRestScenario
  delayMs?: number
}

export function createRestHandlers(options: RestHandlerOptions = {}) {
  const scenario = options.scenario ?? 'success'
  let nextBotNumber = 1
  let quickMatchPolls = 0

  async function beforeResponse() {
    if (scenario === 'delay') await delay(options.delayMs ?? 300)
  }

  function unavailable() {
    return scenario === 'error'
      ? HttpResponse.json(
          { code: 'MOCK_API_ERROR', message: '선택된 mock 오류입니다.' },
          { status: 503 },
        )
      : null
  }

  return [
    http.post('/api/v1/auth/session', async ({ request }) => {
      await beforeResponse()
      const body = (await request.json()) as { code?: string }
      if (!body.code) return HttpResponse.text('invalid_login_code', { status: 401 })
      return (
        unavailable() ??
        HttpResponse.json({
          userId: 'mock-member-id',
          nickname: '카카오회원',
          type: 'MEMBER',
          sessionToken: 'mock-member-token',
        })
      )
    }),
    http.get('/api/v1/auth/me', async ({ request }) => {
      await beforeResponse()
      if (!request.headers.get('Authorization')?.startsWith('Bearer ')) {
        return HttpResponse.text('session_expired', { status: 401 })
      }
      return HttpResponse.json({
        userId: 'mock-member-id',
        nickname: '카카오회원',
        type: 'MEMBER',
        sessionToken: null,
      })
    }),
    http.delete('/api/v1/auth/session', async () => {
      await beforeResponse()
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/v1/rooms', async ({ request }) => {
      await beforeResponse()
      const body = (await request.json()) as EnterRoomRequest
      const search = new URL(request.url).searchParams
      const party = search.get('party') === 'true'
      const requestedGameCode = mockGameCode(search.get('game_code'))
      const session = mockRoomSession(body, party)
      if (body.room_id && body.room_id !== creatorSession.roomCode) {
        return HttpResponse.text('room_not_found', { status: 404 })
      }
      const gameCode = enteredGameCode(body, requestedGameCode)
      if (!body.room_id) {
        saveMockRoomSnapshot(initialRoomSnapshot(party, gameCode))
      }
      return (
        unavailable() ?? HttpResponse.json(toEnterRoomResponse(session, body.nickname, gameCode))
      )
    }),
    http.post('/api/v1/quick-matches', async ({ request }) => {
      await beforeResponse()
      const failure = quickMatchUnauthorized(request) ?? unavailable()
      if (failure) return failure
      quickMatchPolls = 0
      const gameCode = mockGameCode(new URL(request.url).searchParams.get('game_code'))
      saveMockRoomSnapshot(initialRoomSnapshot(false, gameCode))
      return HttpResponse.json({ status: 'WAITING', roomId: null, gameCode })
    }),
    http.get('/api/v1/quick-matches', async ({ request }) => {
      await beforeResponse()
      const failure = quickMatchUnauthorized(request) ?? unavailable()
      if (failure) return failure
      quickMatchPolls += 1
      const gameCode = loadMockRoomSnapshot()?.gameCode ?? 'YACHT_DICE'
      if (quickMatchPolls < 2) {
        return HttpResponse.json({ status: 'WAITING', roomId: null, gameCode })
      }
      return HttpResponse.json({
        status: quickMatchPolls < 3 ? 'MATCHED' : 'PLAYING',
        roomId: MOCK_ROOM_ID,
        gameCode,
      })
    }),
    http.delete('/api/v1/quick-matches', async ({ request }) => {
      await beforeResponse()
      const failure = quickMatchUnauthorized(request)
      if (failure) return failure
      quickMatchPolls = 0
      clearMockRoomSnapshot()
      return HttpResponse.json({ status: 'NOT_QUEUED', roomId: null, gameCode: null })
    }),
    http.get('/api/v1/games/:gameId', async ({ params }) => {
      await beforeResponse()
      if (params.gameId !== 'mock-game-id') {
        return HttpResponse.json({ code: 'GAME_NOT_FOUND' }, { status: 404 })
      }
      const stored = loadMockRoomSnapshot()
      return (
        unavailable() ??
        HttpResponse.json(
          toRestRoomSnapshot(stored?.phase === 'playing' ? stored : playingRoomSnapshot),
        )
      )
    }),
    http.post('/api/v1/rooms/:roomCode/games', async ({ params }) => {
      await beforeResponse()
      if (params.roomCode !== MOCK_ROOM_ID) {
        return HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })
      }
      const failure = unavailable()
      if (failure) return failure
      const snapshot = createPlayingRoomSnapshot(Date.now() + MOCK_ROUND_DURATION_MS)
      saveMockRoomSnapshot(snapshot)
      return HttpResponse.json({
        gameId: 'mock-game-id',
        snapshot: toRestRoomSnapshot(snapshot),
      })
    }),
    http.post('/api/v1/rooms/:roomCode/bots', async ({ params }) => {
      await beforeResponse()
      if (params.roomCode !== MOCK_ROOM_ID) {
        return HttpResponse.text('room_not_found', { status: 404 })
      }
      const failure = unavailable()
      if (failure) return failure
      const snapshot = loadMockRoomSnapshot() ?? waitingRoomSnapshot
      if (snapshot.players.length >= (snapshot.capacity ?? 6)) {
        return HttpResponse.text('room_full', { status: 409 })
      }
      const bot: Player = {
        playerId: `bot-${nextBotNumber}`,
        nickname: `요르봇 ${nextBotNumber}`,
        status: 'online',
        kind: 'BOT',
        isHost: false,
      }
      nextBotNumber += 1
      const updated = { ...snapshot, players: [...snapshot.players, bot] }
      saveMockRoomSnapshot(updated)
      return HttpResponse.json(toRestRoomSnapshot(updated))
    }),
    http.delete('/api/v1/rooms/:roomCode/bots/:botId', async ({ params }) => {
      await beforeResponse()
      const snapshot = loadMockRoomSnapshot() ?? waitingRoomSnapshot
      const botExists = snapshot.players.some(
        (player) => player.playerId === params.botId && player.kind === 'BOT',
      )
      if (params.roomCode !== MOCK_ROOM_ID || !botExists) {
        return HttpResponse.text('bot_not_found', { status: 404 })
      }
      const failure = unavailable()
      if (failure) return failure
      const updated = {
        ...snapshot,
        players: snapshot.players.filter((player) => player.playerId !== params.botId),
      }
      saveMockRoomSnapshot(updated)
      return HttpResponse.json(toRestRoomSnapshot(updated))
    }),
    http.post('/api/v1/rooms/:roomCode/lobby', async ({ params }) => {
      await beforeResponse()
      if (params.roomCode !== MOCK_ROOM_ID) {
        return HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })
      }
      const failure = unavailable()
      if (failure) return failure
      clearMockRoomSnapshot()
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/v1/games/:gameId/score-candidates', async ({ params, request }) => {
      await beforeResponse()
      if (params.gameId !== 'mock-game-id') {
        return HttpResponse.json({ code: 'GAME_NOT_FOUND' }, { status: 404 })
      }
      const body = (await request.json()) as ScoreCandidatesRequest
      return unavailable() ?? HttpResponse.json({ candidates: calculateScoreCandidates(body.dice) })
    }),
    http.delete('/api/v1/rooms/:roomCode/players/me', async ({ params }) => {
      await beforeResponse()
      if (params.roomCode !== MOCK_ROOM_ID) {
        return HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })
      }
      const failure = unavailable()
      if (failure) return failure
      clearMockRoomSnapshot()
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/rankings/weekly', async ({ request }) => {
      await beforeResponse()
      const failure = unavailable()
      if (failure) return failure
      const limit = Number(
        new URL(request.url).searchParams.get('limit') ?? mockWeeklyRanking.length,
      )
      return HttpResponse.json({
        weekStart: MOCK_WEEK_START,
        entries: mockWeeklyRanking.slice(0, Math.max(0, limit)),
      })
    }),
    http.get('/api/v1/rankings/weekly/me', async ({ request }) => {
      await beforeResponse()
      if (!request.headers.get('Authorization')?.startsWith('Bearer ')) {
        return HttpResponse.text('session_expired', { status: 401 })
      }
      const failure = unavailable()
      if (failure) return failure
      return HttpResponse.json({ weekStart: MOCK_WEEK_START, rank: 27, bestScore: 143 })
    }),
  ]
}

const MOCK_WEEK_START = '2026-08-03'

const mockWeeklyRanking = [
  { rank: 1, userId: 'mock-member-id', nickname: '카카오회원', bestScore: 312 },
  { rank: 2, userId: 'mock-rival-1', nickname: '주사위요정', bestScore: 288 },
  { rank: 2, userId: 'mock-rival-2', nickname: '한손잡이', bestScore: 288 },
  { rank: 4, userId: 'mock-rival-3', nickname: '엉뚱한선장', bestScore: 254 },
  { rank: 5, userId: 'mock-rival-4', nickname: '요트초보', bestScore: 231 },
  { rank: 6, userId: 'mock-rival-5', nickname: '굴림장인', bestScore: 205 },
]

function toRestRoomSnapshot(snapshot: typeof waitingRoomSnapshot) {
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

function toEnterRoomResponse(
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

function quickMatchUnauthorized(request: Request) {
  const authorized =
    request.headers.get('Authorization')?.startsWith('Bearer ') &&
    Boolean(request.headers.get('X-User-Id'))
  return authorized ? null : HttpResponse.text('unauthorized', { status: 401 })
}

function mockGameCode(value: string | null): GameCode {
  return value === 'PING_PONG' ? 'PING_PONG' : 'YACHT_DICE'
}

function mockRoomSession(body: EnterRoomRequest, party: boolean): RoomSession {
  if (body.room_id) return participantSession
  return party ? dashboardSession : creatorSession
}

function enteredGameCode(body: EnterRoomRequest, requestedGameCode: GameCode): GameCode {
  if (!body.room_id) return requestedGameCode
  return loadMockRoomSnapshot()?.gameCode ?? 'YACHT_DICE'
}

function initialRoomSnapshot(party: boolean, gameCode: GameCode): RoomSnapshot {
  return party ? createPartyWaitingSnapshot(gameCode) : { ...waitingRoomSnapshot, gameCode }
}

function createPartyWaitingSnapshot(gameCode: GameCode): RoomSnapshot {
  const { hostId: _hostId, ...withoutHost } = waitingRoomSnapshot
  return {
    ...withoutHost,
    gameCode,
    capacity: gameCode === 'PING_PONG' ? 2 : 6,
    players: [],
  }
}
