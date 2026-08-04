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
  // mock에는 상대가 없으므로 조회 횟수로 대기 → 매칭 → 시작을 흉내낸다. 한 번은 WAITING을
  // 돌려줘야 백드롭과 취소 버튼이 실제로 보인다.
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
    // 로그인 코드 교환. mock에서는 카카오까지 갈 수 없으므로, 콜백이 넘긴 코드를 그대로
    // 받아 고정 회원을 돌려준다 — 프론트의 교환·저장·표시 경로만 검증하기 위한 최소 구현이다.
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
      // ?party=true = 파티 모드 방 열기. 이 세션은 대시보드가 되고 플레이어 명단에 들어가지 않는다.
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
    // 빠른 대전. 실서버는 두 사용자를 짝지어 주지만 mock은 혼자이므로, 두 번째 조회에서
    // 매칭이 잡히고 그다음 조회에서 게임이 시작된 것으로 둔다. 방은 기존 mock 방(YORR64)이라
    // 매칭 이후 대기실·게임 화면이 그대로 이어진다.
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
      // 진행 중이던 방 상태가 있으면 그걸 돌려준다 — 점수판이 기록과 같이 간다.
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
      // 게임 시작을 방 상태로 기억한다 — 이후 WS room.join(재접속)이 이 상태를 돌려준다.
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
      // 대기실 복귀 = 방이 다시 대기 상태다. 기억을 지우면 room.join 기본값(대기 중)과 같다.
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
    // 주간 랭킹. 띠는 5명(BAND_COUNT)까지 세우고 나머지는 드롭다운이 받으므로, 그 둘이 갈리는
    // 것을 보려면 5명보다 길어야 한다. 동점(2위 둘)을 섞어 순위 번호가 건너뛰는 것까지 mock에서
    // 눈으로 확인한다.
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
    // 내 순위. mock의 고정 회원은 상위 목록에 <b>일부러 넣지 않았다</b> — "10위 밖이면 내 줄을
    // 따로 잇는다"가 이 화면의 미묘한 부분이라, mock에서 그 경로가 기본으로 보여야 한다.
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

/** mock의 "이번 주" 월요일. 값 자체는 화면 표기에 쓰이지 않지만 계약을 채운다. */
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
    // 실서버는 round.start(WS)로 턴을 알리지만 mock WS는 서버 주도 push가 없다.
    // REST 스냅샷에 game을 실어 mock 환경에서도 "내 턴"이 성립하게 한다.
    game: snapshot.game
      ? { ...snapshot.game, roundDeadline: Date.now() + MOCK_ROUND_DURATION_MS }
      : null,
  }
}

/** 대시보드는 닉네임을 보내지 않는다 — 실서버처럼 mock도 그때는 세션의 이름을 돌려준다. */
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

/** 빠른 대전은 회원 세션 전용이다 — 실서버처럼 헤더가 없으면 평문 401로 거절한다. */
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
