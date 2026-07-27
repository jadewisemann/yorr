import { describe, expect, it } from 'vitest'
import { HttpGameApiClient } from '@/api/gameApi'
import { MOCK_ROOM_ID } from './fixtures'
import { createRestHandlers } from './restHandlers'
import { mockApiServer } from './server'

const client = new HttpGameApiClient()

describe('REST mock handlers', () => {
  it('방 생성·참가·대기실·게임·점수 흐름을 제공한다', async () => {
    const creator = await client.createRoom({
      mode: 'online',
      gameType: 'yacht',
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
        mode: 'online',
        gameType: 'yacht',
        nickname: '호스트',
      }),
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(body).not.toHaveProperty('membershipRole')
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
