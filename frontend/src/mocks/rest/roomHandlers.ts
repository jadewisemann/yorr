import { HttpResponse, http } from 'msw'
import type { GameCode } from '@/games'
import type { Player, RoomSnapshot } from '@/realtime/wsEvents'
import type { EnterRoomRequest, RoomSession } from '@/room/api/roomApi'
import {
  creatorSession,
  dashboardSession,
  MOCK_ROOM_ID,
  participantSession,
  waitingRoomSnapshot,
} from '../fixtures'
import { clearMockRoomSnapshot, loadMockRoomSnapshot, saveMockRoomSnapshot } from '../mockRoomState'
import {
  initialRoomSnapshot,
  mockGameCode,
  toEnterRoomResponse,
  toRestRoomSnapshot,
} from './serializers'
import type { MockContext } from './types'

/** 방 생성·입장, 봇 추가/삭제, 대기실 복귀, 나가기. */
export const roomHandlers = ({ beforeResponse, state, unavailable }: MockContext) => [
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
    return unavailable() ?? HttpResponse.json(toEnterRoomResponse(session, body.nickname, gameCode))
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
      playerId: `bot-${state.nextBotNumber}`,
      nickname: `요르봇 ${state.nextBotNumber}`,
      status: 'online',
      kind: 'BOT',
      isHost: false,
    }
    state.nextBotNumber += 1
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
    const updated = withoutPlayer(snapshot, String(params.botId))
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

function withoutPlayer(snapshot: RoomSnapshot, playerId: string): RoomSnapshot {
  return {
    ...snapshot,
    players: snapshot.players.filter((player) => player.playerId !== playerId),
  }
}

function mockRoomSession(body: EnterRoomRequest, party: boolean): RoomSession {
  if (body.room_id) return participantSession
  return party ? dashboardSession : creatorSession
}

function enteredGameCode(body: EnterRoomRequest, requestedGameCode: GameCode): GameCode {
  if (!body.room_id) return requestedGameCode
  return loadMockRoomSnapshot()?.gameCode ?? 'YACHT_DICE'
}
