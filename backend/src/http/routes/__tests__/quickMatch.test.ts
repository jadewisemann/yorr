import fastify, { type FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { afterEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { GAME_CATALOG, GameCatalog, type GameMetadata } from '../../../game/catalog.js'
import { GameLifecycleService } from '../../../game/lifecycle.js'
import { QuickMatchService } from '../../../room/quickMatchService.js'
import { RoomService } from '../../../room/roomService.js'
import { UserService } from '../../../user/session.js'
import { RoomSessionRegistry } from '../../../ws/registry.js'
import { registerQuickMatchRoutes } from '../quickMatch.js'

/**
 * 퀵매치 REST — backend-java `QuickMatchController`.
 *
 * 조립을 `server.ts`가 아니라 여기서 한다(3.5 시점에 배선이 아직 없다). 방 REST
 * 통합 테스트와 같은 이유로 모킹 없이 하네스 Redis를 쓴다 — 계약의 절반이
 * "도메인 오류 → 상태 코드 + plain-text 본문" 매핑이라 서비스를 모킹하면 테스트가
 * 그 매핑을 스스로 정의해 버린다.
 */
interface QuickMatchBody {
  status: string
  roomId: string | null
  gameCode: string | null
}

const authHeaders = (userId: string, token: string): Record<string, string> => ({
  'X-User-Id': userId,
  Authorization: `Bearer ${token}`,
})

describeRedis('퀵매치 REST', () => {
  const redis = useRedis()
  let app: FastifyInstance | undefined

  const build = async (games: readonly GameMetadata[] = GAME_CATALOG): Promise<FastifyInstance> => {
    const client = redis() as Redis
    const rooms = new RoomService(client)
    const users = new UserService(client)
    const catalog = new GameCatalog(games)
    const instance = fastify({ logger: false })
    await instance.register(
      async (api) => {
        await registerQuickMatchRoutes(api, {
          users,
          catalog,
          matches: new QuickMatchService({
            redis: client,
            rooms,
            users,
            catalog,
            presence: new RoomSessionRegistry(),
            games: new GameLifecycleService(rooms, catalog),
          }),
        })
      },
      { prefix: '/api/v1' },
    )
    await instance.ready()
    app = instance
    return instance
  }

  /** 실제 게스트 세션을 발급한다 — 인증 경로까지 같은 코드로 통과해야 한다. */
  const guest = async (nickname: string): Promise<Record<string, string>> => {
    const session = await new UserService(redis() as Redis).createGuest(nickname)
    return authHeaders(session.userId, session.sessionToken)
  }

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('POST → WAITING, GET → 같은 상태, DELETE → NOT_QUEUED', async () => {
    const instance = await build()
    const headers = await guest('요르')

    const entered = await instance.inject({
      method: 'POST',
      url: '/api/v1/quick-matches?game_code=YACHT_DICE',
      headers,
    })
    expect(entered.statusCode).toBe(200)
    expect(entered.json<QuickMatchBody>()).toEqual({
      status: 'WAITING',
      roomId: null,
      gameCode: 'YACHT_DICE',
    })

    const polled = await instance.inject({ method: 'GET', url: '/api/v1/quick-matches', headers })
    expect(polled.json<QuickMatchBody>().status).toBe('WAITING')

    const cancelled = await instance.inject({
      method: 'DELETE',
      url: '/api/v1/quick-matches',
      headers,
    })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json<QuickMatchBody>()).toEqual({
      status: 'NOT_QUEUED',
      roomId: null,
      gameCode: 'YACHT_DICE',
    })
  })

  it('두 사람이 들어오면 둘 다 같은 방으로 MATCHED가 된다', async () => {
    const instance = await build()
    const first = await guest('A')
    const second = await guest('B')

    const enter = (headers: Record<string, string>) =>
      instance.inject({
        method: 'POST',
        url: '/api/v1/quick-matches?game_code=DUEL',
        headers,
      })

    expect((await enter(first)).json<QuickMatchBody>().status).toBe('WAITING')
    const matched = (await enter(second)).json<QuickMatchBody>()
    const polled = await instance.inject({
      method: 'GET',
      url: '/api/v1/quick-matches',
      headers: first,
    })

    expect(matched.status).toBe('MATCHED')
    expect(matched.gameCode).toBe('DUEL')
    expect(polled.json<QuickMatchBody>().roomId).toBe(matched.roomId)
  })

  it('game_code가 없으면 야추다', async () => {
    const instance = await build()
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/quick-matches',
      headers: await guest('요르'),
    })

    expect(response.json<QuickMatchBody>().gameCode).toBe('YACHT_DICE')
  })

  it('인증 실패는 401 + 본문 unauthorized — 방 REST의 invalid_guest_session이 아니다', async () => {
    const instance = await build()

    for (const [method, url] of [
      ['POST', '/api/v1/quick-matches?game_code=YACHT_DICE'],
      ['GET', '/api/v1/quick-matches'],
      ['DELETE', '/api/v1/quick-matches'],
    ] as const) {
      const response = await instance.inject({ method, url })
      expect(response.statusCode).toBe(401)
      expect(response.body).toBe('unauthorized')
      // plain-text다 — JSON 봉투로 감싸면 프론트의 코드 매핑이 끊긴다.
      expect(response.headers['content-type']).toContain('text/plain')
    }
  })

  it('모르는 게임 코드는 400 invalid_game_code', async () => {
    const instance = await build()
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/quick-matches?game_code=NOPE',
      headers: await guest('요르'),
    })

    expect(response.statusCode).toBe(400)
    expect(response.body).toBe('invalid_game_code')
  })

  it('정원보다 많은 인원이 필요한 게임은 400 quick_match_not_supported', async () => {
    const instance = await build([
      ...GAME_CATALOG,
      { code: 'TOO_BIG', name: 'Too big', minPlayers: 3, maxPlayers: 2, supportsBots: false },
    ])
    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/quick-matches?game_code=TOO_BIG',
      headers: await guest('요르'),
    })

    expect(response.statusCode).toBe(400)
    expect(response.body).toBe('quick_match_not_supported')
  })

  it('이미 방에 있으면 409 already_in_room', async () => {
    const instance = await build()
    const users = new UserService(redis() as Redis)
    const session = await users.createGuest('요르')
    await users.assignRoom(session.userId, 'ABC123', 'ABC123', session.userId)

    const response = await instance.inject({
      method: 'POST',
      url: '/api/v1/quick-matches?game_code=YACHT_DICE',
      headers: authHeaders(session.userId, session.sessionToken),
    })

    expect(response.statusCode).toBe(409)
    expect(response.body).toBe('already_in_room')
  })
})
