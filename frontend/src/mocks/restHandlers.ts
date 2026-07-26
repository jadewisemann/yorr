import { delay, HttpResponse, http } from 'msw'
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  RoomSession,
  SubmitScoreRequest,
} from '@/api/gameApi'
import {
  createEmptyScoreBoard,
  creatorSession,
  MOCK_ROOM_ID,
  participantSession,
  playingRoomSnapshot,
  scoreCandidates,
  waitingRoomSnapshot,
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
      const body = (await request.json()) as CreateRoomRequest
      return (
        unavailable() ??
        HttpResponse.json(withNickname(creatorSession, body.nickname), { status: 201 })
      )
    }),
    http.post('/api/v1/rooms/:roomCode/participants', async ({ params, request }) => {
      await beforeResponse()
      if (params.roomCode !== creatorSession.roomCode) {
        return HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })
      }
      const body = (await request.json()) as JoinRoomRequest
      return (
        unavailable() ??
        HttpResponse.json(withNickname(participantSession, body.nickname), { status: 201 })
      )
    }),
    http.get('/api/v1/rooms/:roomId/lobby', async ({ params }) => {
      await beforeResponse()
      if (params.roomId !== MOCK_ROOM_ID) {
        return HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })
      }
      return unavailable() ?? HttpResponse.json(waitingRoomSnapshot)
    }),
    http.get('/api/v1/rooms/:roomId/game', async () => {
      await beforeResponse()
      return unavailable() ?? HttpResponse.json(playingRoomSnapshot)
    }),
    http.post('/api/v1/rooms/:roomId/game', async () => {
      await beforeResponse()
      return unavailable() ?? HttpResponse.json(playingRoomSnapshot)
    }),
    http.post('/api/v1/rooms/:roomId/game/rolls', async () => {
      await beforeResponse()
      return unavailable() ?? HttpResponse.json(playingRoomSnapshot)
    }),
    http.get('/api/v1/rooms/:roomId/scores/candidates', async () => {
      await beforeResponse()
      return unavailable() ?? HttpResponse.json(scoreCandidates)
    }),
    http.post('/api/v1/rooms/:roomId/scores', async ({ request }) => {
      await beforeResponse()
      const body = (await request.json()) as SubmitScoreRequest
      const scoreboard = createEmptyScoreBoard()
      scoreboard.categories[body.category] = scoreCandidates.candidates[body.category]
      scoreboard.total = scoreCandidates.candidates[body.category]
      return unavailable() ?? HttpResponse.json(scoreboard)
    }),
    http.get('/api/v1/rooms/:roomId/scores', async () => {
      await beforeResponse()
      return unavailable() ?? HttpResponse.json(playingRoomSnapshot.game?.scores ?? {})
    }),
  ]
}

function withNickname(session: RoomSession, nickname: string): RoomSession {
  return {
    ...session,
    snapshot: {
      ...session.snapshot,
      players: session.snapshot.players.map((player) =>
        player.playerId === session.you ? { ...player, nickname } : player,
      ),
    },
  }
}
