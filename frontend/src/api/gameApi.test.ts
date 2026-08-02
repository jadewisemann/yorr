import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { mockApiServer } from '@/mocks/server'
import { HttpGameApiClient } from './gameApi'

const client = new HttpGameApiClient()

const auth = {
  sessionToken: creatorSession.sessionToken,
  userId: creatorSession.you,
}

function respondToGame(body: unknown) {
  // 일부러 형태가 어긋난 응답(배열·문자열 필드 등)까지 흘려보내 클라이언트 쪽 검증을 확인한다 —
  // 그래서 body는 unknown이고, HttpResponse.json 쪽 타입에 맞추기 위해서만 캐스팅한다.
  mockApiServer.use(
    http.get('/api/v1/games/:gameId', () =>
      HttpResponse.json(body as Parameters<typeof HttpResponse.json>[0]),
    ),
  )
}

function restSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: 'YORR64',
    phase: 'PLAYING',
    players: [{ playerId: 'player-1', nickname: '호스트' }],
    ...overrides,
  }
}

describe('returnToLobby', () => {
  it('host 인증 헤더를 실어 대기실 복귀를 요청하고 본문 없는 응답을 받아들인다', async () => {
    let requestPath = ''
    let authorization = ''
    let userId = ''
    mockApiServer.use(
      http.post('/api/v1/rooms/:roomCode/lobby', ({ request }) => {
        requestPath = new URL(request.url).pathname
        authorization = request.headers.get('Authorization') ?? ''
        userId = request.headers.get('X-User-Id') ?? ''
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(client.returnToLobby('YORR64', auth)).resolves.toBeUndefined()

    expect(requestPath).toBe('/api/v1/rooms/YORR64/lobby')
    expect(authorization).toBe(`Bearer ${creatorSession.sessionToken}`)
    expect(userId).toBe(creatorSession.you)
  })
})

describe('REST 스냅샷 → 프론트 스냅샷 변환', () => {
  it('서버 phase를 프론트 phase로 옮기고 참가자를 online으로 채운다', async () => {
    respondToGame(restSnapshot({ phase: 'LOBBY' }))
    await expect(client.getGame('game-1')).resolves.toEqual({
      roomId: 'YORR64',
      phase: 'waiting',
      players: [{ playerId: 'player-1', nickname: '호스트', status: 'online' }],
    })

    respondToGame(restSnapshot({ phase: 'FINISHED' }))
    await expect(client.getGame('game-1')).resolves.toMatchObject({ phase: 'finished' })
  })

  it('모르는 phase는 스냅샷 전체를 거부한다 — 화면이 임의 상태를 추측하지 않게', async () => {
    respondToGame(restSnapshot({ phase: 'PAUSED' }))

    await expect(client.getGame('game-1')).rejects.toThrow('Invalid room snapshot response')
  })

  it('스냅샷이 객체가 아니거나 필수 필드가 비면 거부한다', async () => {
    respondToGame([])
    await expect(client.getGame('game-1')).rejects.toThrow('Invalid room snapshot response')

    respondToGame(restSnapshot({ roomCode: '' }))
    await expect(client.getGame('game-1')).rejects.toThrow('Invalid room snapshot response')

    respondToGame(restSnapshot({ players: 'nope' }))
    await expect(client.getGame('game-1')).rejects.toThrow('Invalid room snapshot response')

    respondToGame(restSnapshot({ players: [{ nickname: '이름만' }] }))
    await expect(client.getGame('game-1')).rejects.toThrow('Invalid room snapshot response')
  })

  it('game 필드가 계약과 다르면 스냅샷은 살리고 진행 상태만 버린다', async () => {
    // 진행 상태의 SSOT는 WS다 — REST의 선택 필드가 깨졌다고 방 정보까지 버릴 이유가 없다.
    for (const game of [
      null,
      { activePlayerId: '', roundNumber: 1, roundDeadline: 1, scores: {} },
      { activePlayerId: 'p1', roundNumber: '1', roundDeadline: 1, scores: {} },
      { activePlayerId: 'p1', roundNumber: 1, roundDeadline: null, scores: {} },
      { activePlayerId: 'p1', roundNumber: 1, roundDeadline: 1, scores: [] },
    ]) {
      respondToGame(restSnapshot({ game }))
      await expect(client.getGame('game-1')).resolves.not.toHaveProperty('game')
    }
  })

  it('game 필드가 계약을 지키면 그대로 실어 온다', async () => {
    respondToGame(
      restSnapshot({
        game: { activePlayerId: 'player-1', roundNumber: 2, roundDeadline: 1_700, scores: {} },
      }),
    )

    await expect(client.getGame('game-1')).resolves.toMatchObject({
      game: { activePlayerId: 'player-1', roundNumber: 2, roundDeadline: 1_700 },
    })
  })
})

describe('게임 시작 응답 검증', () => {
  it('gameId가 없는 응답은 거부한다', async () => {
    mockApiServer.use(
      http.post('/api/v1/rooms/:roomCode/games', () =>
        HttpResponse.json({ snapshot: restSnapshot() }),
      ),
    )

    await expect(client.startGame('YORR64', auth)).rejects.toThrow('Invalid game start response')
  })
})

describe('요청 취소', () => {
  it('signal을 넘기면 취소된 요청은 중단 오류로 끝난다', async () => {
    const controller = new AbortController()
    mockApiServer.use(
      http.get('/api/v1/games/:gameId', async () => {
        controller.abort()
        return HttpResponse.json(restSnapshot())
      }),
    )

    await expect(client.getGame('game-1', { signal: controller.signal })).rejects.toThrow()
  })
})
