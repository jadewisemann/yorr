import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { HttpGameApiClient } from '@/api/gameApi'
import { creatorSession, participantSession } from './fixtures'
import { clearMockRoomSnapshot } from './mockRoomState'
import { createRestHandlers } from './restHandlers'
import { mockApiServer } from './server'

const client = new HttpGameApiClient()

describe('REST mock handlers', () => {
  // startGame이 방 상태를 기억하므로, 테스트 순서에 따라 응답이 달라지지 않게 지운다.
  beforeEach(() => clearMockRoomSnapshot())

  it('OpenAPI에 정의된 방·게임 REST 흐름을 제공한다', async () => {
    const creator = await client.createRoom({
      nickname: '느긋한 주사위',
    })
    const participant = await client.joinRoom(creator.roomCode, { nickname: '참가자' })
    const startedGame = await client.startGame(creator.roomCode, {
      sessionToken: creator.sessionToken,
      userId: creator.you,
    })
    const game = await client.getGame(startedGame.gameId)
    const candidates = await client.getScoreCandidates(startedGame.gameId, {
      dice: [1, 2, 3, 4, 6],
    })
    await client.leaveRoom(creator.roomCode, {
      sessionToken: creator.sessionToken,
      userId: creator.you,
    })

    expect(creator.membershipRole).toBe('host')
    expect(participant.membershipRole).toBe('participant')
    expect(participant.you).not.toBe(creator.you)
    expect(startedGame.gameId).toBe('mock-game-id')
    expect(startedGame.snapshot.phase).toBe('playing')
    expect(game.phase).toBe('playing')
    expect(candidates.candidates.choice).toBe(16)
  })

  it('REST 응답 계약에는 프론트 전용 역할을 추가하지 않는다', async () => {
    const response = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: '호스트',
      }),
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(body).not.toHaveProperty('membershipRole')
    expect(body).toMatchObject({
      id: creatorSession.you,
      token: creatorSession.sessionToken,
      room_id: creatorSession.roomId,
    })
  })

  it('최신 백엔드 계약으로 방을 생성하고 참가한다', async () => {
    const requests: unknown[] = []
    mockApiServer.use(
      http.post('/api/v1/rooms', async ({ request }) => {
        const body = (await request.json()) as { nickname: string; room_id?: string }
        requests.push(body)
        const session = body.room_id ? participantSession : creatorSession
        return HttpResponse.json({
          id: session.you,
          nickname: body.nickname,
          token: session.sessionToken,
          room_id: session.roomId,
        })
      }),
    )

    const creator = await client.createRoom({ nickname: '호스트' })
    const participant = await client.joinRoom('YORR64', { nickname: '참가자' })

    expect(requests).toEqual([{ nickname: '호스트' }, { nickname: '참가자', room_id: 'YORR64' }])
    expect(creator).toMatchObject({
      roomId: creatorSession.roomId,
      roomCode: creatorSession.roomId,
      gameId: null,
      you: creatorSession.you,
      membershipRole: 'host',
      sessionToken: creatorSession.sessionToken,
      snapshot: null,
    })
    expect(participant).toMatchObject({
      roomId: participantSession.roomId,
      membershipRole: 'participant',
      snapshot: null,
    })
  })

  it('게임 시작 시 최신 URL과 인증 헤더를 사용한다', async () => {
    let requestUrl = ''
    let authorization = ''
    let userId = ''
    mockApiServer.use(
      http.post('/api/v1/rooms/:roomCode/games', ({ request }) => {
        requestUrl = request.url
        authorization = request.headers.get('Authorization') ?? ''
        userId = request.headers.get('X-User-Id') ?? ''
        return HttpResponse.json({
          gameId: 'game-1',
          snapshot: {
            roomCode: creatorSession.roomCode,
            gameId: 'game-1',
            hostId: creatorSession.you,
            phase: 'PLAYING',
            capacity: 6,
            players: [
              {
                playerId: creatorSession.you,
                nickname: creatorSession.nickname,
                score: 0,
              },
            ],
          },
        })
      }),
    )

    const result = await client.startGame(creatorSession.roomCode, {
      sessionToken: creatorSession.sessionToken,
      userId: creatorSession.you,
    })

    expect(new URL(requestUrl).pathname).toBe(`/api/v1/rooms/${creatorSession.roomCode}/games`)
    expect(authorization).toBe(`Bearer ${creatorSession.sessionToken}`)
    expect(userId).toBe(creatorSession.you)
    expect(result).toMatchObject({
      gameId: 'game-1',
      snapshot: {
        roomId: creatorSession.roomCode,
        phase: 'playing',
        players: [
          {
            playerId: creatorSession.you,
            nickname: creatorSession.nickname,
            status: 'online',
          },
        ],
      },
    })
  })

  it('점수 후보와 방 나가기 요청도 OpenAPI 계약을 따른다', async () => {
    let scoreRequestBody: unknown
    let leaveAuthorization = ''
    let leaveUserId = ''
    mockApiServer.use(
      http.post('/api/v1/games/:gameId/score-candidates', async ({ request }) => {
        scoreRequestBody = await request.json()
        return HttpResponse.json({ candidates: { choice: 16 } })
      }),
      http.delete('/api/v1/rooms/:roomCode/players/me', ({ request }) => {
        leaveAuthorization = request.headers.get('Authorization') ?? ''
        leaveUserId = request.headers.get('X-User-Id') ?? ''
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await client.getScoreCandidates('game-1', { dice: [1, 2, 3, 4, 6] })
    await client.leaveRoom(creatorSession.roomCode, {
      sessionToken: creatorSession.sessionToken,
      userId: creatorSession.you,
    })

    expect(scoreRequestBody).toEqual({ dice: [1, 2, 3, 4, 6] })
    expect(leaveAuthorization).toBe(`Bearer ${creatorSession.sessionToken}`)
    expect(leaveUserId).toBe(creatorSession.you)
  })

  it('필수 필드가 없는 성공 응답을 세션으로 저장하지 않는다', async () => {
    mockApiServer.use(http.post('/api/v1/rooms', () => HttpResponse.json({ room_id: 'YORR64' })))

    await expect(client.createRoom({ nickname: '호스트' })).rejects.toThrow(
      'Invalid enter room response',
    )
  })

  it('오류 시나리오를 선택할 수 있다', async () => {
    mockApiServer.use(...createRestHandlers({ scenario: 'error' }))

    await expect(client.getGame('mock-game-id')).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        code: 'MOCK_API_ERROR',
        message: '선택된 mock 오류입니다.',
      }),
    )
  })

  it('오류 시나리오는 모든 endpoint에 동일하게 적용된다', async () => {
    mockApiServer.use(...createRestHandlers({ scenario: 'error' }))
    const auth = { sessionToken: creatorSession.sessionToken, userId: creatorSession.you }

    const failures = await Promise.all(
      [
        client.createRoom({ nickname: '호스트' }),
        client.startGame(creatorSession.roomCode, auth),
        client.returnToLobby(creatorSession.roomCode, auth),
        client.getScoreCandidates('mock-game-id', { dice: [1, 2, 3, 4, 5] }),
        client.leaveRoom(creatorSession.roomCode, auth),
      ].map((request) => request.then(() => null).catch((error: unknown) => error)),
    )

    expect(failures.map((error) => (error as { code?: string }).code)).toEqual(
      Array.from({ length: 5 }, () => 'MOCK_API_ERROR'),
    )
  })

  it('delay 시나리오는 응답을 미뤄 로딩 구간을 재현한다', async () => {
    mockApiServer.use(...createRestHandlers({ scenario: 'delay', delayMs: 20 }))
    let settled = false

    const pending = client.getGame('mock-game-id').then((snapshot) => {
      settled = true
      return snapshot
    })

    expect(settled).toBe(false)
    await expect(pending).resolves.toMatchObject({ phase: 'playing' })
  })

  it('mock이 아는 방·게임이 아니면 404로 응답한다', async () => {
    const auth = { sessionToken: creatorSession.sessionToken, userId: creatorSession.you }

    await expect(client.joinRoom('NOPE99', { nickname: '참가자' })).rejects.toMatchObject({
      status: 404,
      code: 'ROOM_NOT_FOUND',
    })
    await expect(client.getGame('other-game')).rejects.toMatchObject({
      status: 404,
      code: 'GAME_NOT_FOUND',
    })
    await expect(client.startGame('NOPE99', auth)).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    })
    await expect(client.returnToLobby('NOPE99', auth)).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    })
    await expect(
      client.getScoreCandidates('other-game', { dice: [1, 2, 3, 4, 5] }),
    ).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' })
    await expect(client.leaveRoom('NOPE99', auth)).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND',
    })
  })

  it('대기실 복귀는 본문 없는 204로 응답한다', async () => {
    await expect(
      client.returnToLobby(creatorSession.roomCode, {
        sessionToken: creatorSession.sessionToken,
        userId: creatorSession.you,
      }),
    ).resolves.toBeUndefined()
  })
})
