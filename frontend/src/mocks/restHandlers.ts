import { delay, HttpResponse, http } from 'msw'
import type { EnterRoomRequest, EnterRoomResponse, RoomSession } from '@/room/api/roomApi'
import {
  createPlayingRoomSnapshot,
  creatorSession,
  MOCK_ROOM_ID,
  MOCK_ROUND_DURATION_MS,
  participantSession,
  playingRoomSnapshot,
  type waitingRoomSnapshot,
} from './fixtures'
import { clearMockRoomSnapshot, loadMockRoomSnapshot, saveMockRoomSnapshot } from './mockRoomState'

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
