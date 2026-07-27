import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { HttpGameApiClient } from '@/api/gameApi'
import { creatorSession, MOCK_ROOM_ID, participantSession } from './fixtures'
import { createRestHandlers } from './restHandlers'
import { mockApiServer } from './server'

const client = new HttpGameApiClient()

describe('REST mock handlers', () => {
  it('방 생성·참가·대기실·게임·점수 흐름을 제공한다', async () => {
    const creator = await client.createRoom({
      nickname: '느긋한 주사위',
    })
    const participant = await client.joinRoom(creator.roomCode, { nickname: '참가자' })
    const lobby = await client.getLobby(creator.roomId)
    const startedGame = await client.startGame(creator.roomId)
    const game = await client.getGame(creator.roomId)
    const roll = await client.submitRoll(creator.roomId, { dice: [1, 2, 3, 4, 6] })
    const candidates = await client.getScoreCandidates(creator.roomId)
    const score = await client.submitScore(creator.roomId, {
      category: 'choice',
      dice: [1, 2, 3, 4, 6],
    })
    const scoreboard = await client.getScoreboard(creator.roomId)

    expect(creator.membershipRole).toBe('host')
    expect(participant.membershipRole).toBe('participant')
    expect(participant.you).not.toBe(creator.you)
    expect(lobby.phase).toBe('waiting')
    expect(startedGame.phase).toBe('playing')
    expect(game.phase).toBe('playing')
    expect(roll.game?.roundNumber).toBe(1)
    expect(candidates.candidates.choice).toBe(16)
    expect(score.categories.choice).toBe(16)
    expect(scoreboard[creator.you]).toBeDefined()
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

  it('필수 필드가 없는 성공 응답을 세션으로 저장하지 않는다', async () => {
    mockApiServer.use(http.post('/api/v1/rooms', () => HttpResponse.json({ room_id: 'YORR64' })))

    await expect(client.createRoom({ nickname: '호스트' })).rejects.toThrow(
      'Invalid enter room response',
    )
  })

  it('오류 시나리오를 선택할 수 있다', async () => {
    mockApiServer.use(...createRestHandlers({ scenario: 'error' }))

    await expect(client.getGame(MOCK_ROOM_ID)).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        code: 'MOCK_API_ERROR',
        message: '선택된 mock 오류입니다.',
      }),
    )
  })
})
