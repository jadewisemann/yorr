import { delay, HttpResponse, http } from 'msw'
import type { SubmitScoreRequest } from '@/api/gameApi'
import {
  createEmptyScoreBoard,
  guestSession,
  hostSession,
  MOCK_ROOM_ID,
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
    http.post('/api/v1/rooms', async () => {
      await beforeResponse()
      return unavailable() ?? HttpResponse.json(hostSession, { status: 201 })
    }),
    http.post('/api/v1/rooms/:roomId/participants', async () => {
      await beforeResponse()
      return unavailable() ?? HttpResponse.json(guestSession, { status: 201 })
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
