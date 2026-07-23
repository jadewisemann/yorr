import { describe, expect, it } from 'vitest'
import { HttpGameApiClient } from '@/api/gameApi'
import { MOCK_ROOM_ID } from './fixtures'
import { createRestHandlers } from './restHandlers'
import { mockApiServer } from './server'

const client = new HttpGameApiClient()

describe('REST mock handlers', () => {
  it('방 생성·참가·대기실·게임·점수 흐름을 제공한다', async () => {
    const host = await client.createRoom({ mode: 'party', gameType: 'yacht' })
    const guest = await client.joinRoom(host.roomId, { nickname: '참가자' })
    const lobby = await client.getLobby(host.roomId)
    const game = await client.getGame(host.roomId)
    const roll = await client.submitRoll(host.roomId, { dice: [1, 2, 3, 4, 6] })
    const candidates = await client.getScoreCandidates(host.roomId)
    const score = await client.submitScore(host.roomId, {
      category: 'choice',
      dice: [1, 2, 3, 4, 6],
    })
    const scoreboard = await client.getScoreboard(host.roomId)

    expect(guest.you).not.toBe(host.you)
    expect(lobby.phase).toBe('waiting')
    expect(game.phase).toBe('playing')
    expect(roll.game?.roundNumber).toBe(1)
    expect(candidates.candidates.choice).toBe(16)
    expect(score.categories.choice).toBe(16)
    expect(scoreboard[host.you]).toBeDefined()
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
