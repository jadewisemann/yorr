import { HttpResponse, http } from 'msw'
import type { ScoreCandidatesRequest } from '@/room/api/roomApi'
import { calculateScoreCandidates } from '@/yacht/domain/scoring'
import {
  createPlayingRoomSnapshot,
  MOCK_ROOM_ID,
  MOCK_ROUND_DURATION_MS,
  playingRoomSnapshot,
} from '../fixtures'
import { loadMockRoomSnapshot, saveMockRoomSnapshot } from '../mockRoomState'
import { toRestRoomSnapshot } from './serializers'
import type { MockContext } from './types'

/** 게임 조회·시작, 점수 후보 계산. */
export const gameHandlers = ({ beforeResponse, unavailable }: MockContext) => [
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
  http.post('/api/v1/games/:gameId/score-candidates', async ({ params, request }) => {
    await beforeResponse()
    if (params.gameId !== 'mock-game-id') {
      return HttpResponse.json({ code: 'GAME_NOT_FOUND' }, { status: 404 })
    }
    const body = (await request.json()) as ScoreCandidatesRequest
    return unavailable() ?? HttpResponse.json({ candidates: calculateScoreCandidates(body.dice) })
  }),
]
