import { HttpResponse, http } from 'msw'
import { MOCK_ROOM_ID } from '../fixtures'
import { clearMockRoomSnapshot, loadMockRoomSnapshot, saveMockRoomSnapshot } from '../mockRoomState'
import { initialRoomSnapshot, mockGameCode, quickMatchUnauthorized } from './serializers'
import type { MockContext } from './types'

/** 퀵매치 등록·폴링·취소. 폴링 두 번째에 MATCHED, 세 번째에 PLAYING이 된다. */
export const quickMatchHandlers = ({ beforeResponse, state, unavailable }: MockContext) => [
  http.post('/api/v1/quick-matches', async ({ request }) => {
    await beforeResponse()
    const failure = quickMatchUnauthorized(request) ?? unavailable()
    if (failure) return failure
    state.quickMatchPolls = 0
    const gameCode = mockGameCode(new URL(request.url).searchParams.get('game_code'))
    saveMockRoomSnapshot(initialRoomSnapshot(false, gameCode))
    return HttpResponse.json({ status: 'WAITING', roomId: null, gameCode })
  }),
  http.get('/api/v1/quick-matches', async ({ request }) => {
    await beforeResponse()
    const failure = quickMatchUnauthorized(request) ?? unavailable()
    if (failure) return failure
    state.quickMatchPolls += 1
    const gameCode = loadMockRoomSnapshot()?.gameCode ?? 'YACHT_DICE'
    if (state.quickMatchPolls < 2) {
      return HttpResponse.json({ status: 'WAITING', roomId: null, gameCode })
    }
    return HttpResponse.json({
      status: state.quickMatchPolls < 3 ? 'MATCHED' : 'PLAYING',
      roomId: MOCK_ROOM_ID,
      gameCode,
    })
  }),
  http.delete('/api/v1/quick-matches', async ({ request }) => {
    await beforeResponse()
    const failure = quickMatchUnauthorized(request)
    if (failure) return failure
    state.quickMatchPolls = 0
    clearMockRoomSnapshot()
    return HttpResponse.json({ status: 'NOT_QUEUED', roomId: null, gameCode: null })
  }),
]
