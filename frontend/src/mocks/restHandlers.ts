import { delay, HttpResponse, http } from 'msw'
import type { EnterRoomRequest, EnterRoomResponse, RoomSession } from '@/api/gameApi'
import {
  creatorSession,
  MOCK_ROOM_ID,
  MOCK_ROUND_DURATION_MS,
  participantSession,
  playingRoomSnapshot,
  scoreCandidates,
  type waitingRoomSnapshot,
} from './fixtures'

export type MockRestScenario = 'success' | 'delay' | 'error'

export interface RestHandlerOptions {
  scenario?: MockRestScenario
  delayMs?: number
}

export function createRestHandlers(options: RestHandlerOptions = {}) {
  const scenario = options.scenario ?? 'success'

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
    http.post('/api/v1/rooms', async ({ request }) => {
      await beforeResponse()
      const body = (await request.json()) as EnterRoomRequest
      const session = body.room_id ? participantSession : creatorSession
      if (body.room_id && body.room_id !== creatorSession.roomCode) {
        return HttpResponse.text('room_not_found', { status: 404 })
      }
      return unavailable() ?? HttpResponse.json(toEnterRoomResponse(session, body.nickname))
    }),
    http.get('/api/v1/games/:gameId', async ({ params }) => {
      await beforeResponse()
      if (params.gameId !== 'mock-game-id') {
        return HttpResponse.json({ code: 'GAME_NOT_FOUND' }, { status: 404 })
      }
      return unavailable() ?? HttpResponse.json(toRestRoomSnapshot(playingRoomSnapshot))
    }),
    http.post('/api/v1/rooms/:roomCode/games', async ({ params }) => {
      await beforeResponse()
      if (params.roomCode !== MOCK_ROOM_ID) {
        return HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })
      }
      return (
        unavailable() ??
        HttpResponse.json({
          gameId: 'mock-game-id',
          snapshot: toRestRoomSnapshot(playingRoomSnapshot),
        })
      )
    }),
    http.post('/api/v1/games/:gameId/score-candidates', async ({ params }) => {
      await beforeResponse()
      if (params.gameId !== 'mock-game-id') {
        return HttpResponse.json({ code: 'GAME_NOT_FOUND' }, { status: 404 })
      }
      return unavailable() ?? HttpResponse.json(scoreCandidates)
    }),
    http.delete('/api/v1/rooms/:roomCode/players/me', async ({ params }) => {
      await beforeResponse()
      if (params.roomCode !== MOCK_ROOM_ID) {
        return HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })
      }
      return unavailable() ?? new HttpResponse(null, { status: 204 })
    }),
  ]
}

function toRestRoomSnapshot(snapshot: typeof waitingRoomSnapshot) {
  return {
    roomCode: snapshot.roomId,
    gameId: snapshot.phase === 'playing' ? 'mock-game-id' : null,
    hostId: creatorSession.you,
    phase: snapshot.phase.toUpperCase(),
    capacity: 6,
    players: snapshot.players.map((player) => ({
      playerId: player.playerId,
      nickname: player.nickname,
      score: 0,
    })),
    // 실서버는 round.start(WS)로 턴을 알리지만 mock WS는 서버 주도 push가 없다.
    // REST 스냅샷에 game을 실어 mock 환경에서도 "내 턴"이 성립하게 한다.
    game: snapshot.game
      ? { ...snapshot.game, roundDeadline: Date.now() + MOCK_ROUND_DURATION_MS }
      : null,
  }
}

function toEnterRoomResponse(session: RoomSession, nickname: string): EnterRoomResponse {
  return {
    id: session.you,
    nickname,
    token: session.sessionToken,
    room_id: session.roomId,
  }
}
