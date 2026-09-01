import fastify, { type FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { GameScoreQueryService, RedisGameScoreQueryStore } from '../../../game/query/index.js'
import { SCORE_CATEGORIES } from '../../../game/score/index.js'
import { gameKey, gameScoreboardKey, playersKey, roomKey } from '../../../room/keys.js'
import { UserService } from '../../../user/session.js'
import { registerGameQueryRoutes } from '../gameQueries.js'

const ROOM_CODE = 'ROOM1'
const GAME_ID = 'game-1'
const PLAYER_A = 'player-a'
const PLAYER_B = 'player-b'
const PLAYER_C = 'player-c'

interface ScoreBoardResponse {
  categories: Record<string, number | null>
  upperSubtotal: number
  upperBonus: number
  total: number
}

/**
 * **하네스 Redis + 진짜 스토어**로 돈다(`rooms.test.ts`와 같은 방식) —
 * 계약의 절반이 "Redis 상태 → 이유 코드 →
 * HTTP 상태" 매핑이라 스토어를 모킹하면 테스트가 매핑을 스스로 정의해 버린다.
 *
 * `server.ts` 배선에 기대지 않고 라우트만 `/api/v1` 프리픽스로 등록한다.
 */
describeRedis('조회 REST', () => {
  const redis = useRedis()
  let app: FastifyInstance
  let token: string

  beforeEach(async () => {
    const client: Redis = redis()
    const users = new UserService(client)
    // 게스트는 userId가 UUID라 순위 assertion이 흔들린다 — 회원 세션으로 id를 고정한다.
    token = await users.openMemberSession(PLAYER_A, 'A')

    app = fastify({ logger: false })
    await app.register(
      async (api) => {
        await registerGameQueryRoutes(api, {
          users,
          queries: new GameScoreQueryService(new RedisGameScoreQueryStore(client)),
        })
      },
      { prefix: '/api/v1' },
    )
    await app.ready()
  })

  afterEach(async () => {
    await app?.close()
  })

  const auth = (): Record<string, string> => ({
    'X-User-Id': PLAYER_A,
    Authorization: `Bearer ${token}`,
  })

  const startGame = async (phase: string, ...players: string[]): Promise<void> => {
    const client: Redis = redis()
    await client.hset(roomKey(ROOM_CODE), 'gameId', GAME_ID, 'phase', phase, 'capacity', '4')
    await client.hset(gameKey(GAME_ID), 'roomCode', ROOM_CODE)
    for (const playerId of players) await client.hset(playersKey(ROOM_CODE), playerId, playerId)
  }

  const setTotal = async (playerId: string, total: number): Promise<void> => {
    await redis().hset(gameScoreboardKey(GAME_ID, playerId), '_total', String(total))
  }

  const get = (path: string, headers: Record<string, string> = auth()) =>
    app.inject({ method: 'GET', url: `/api/v1${path}`, headers })

  const boardOf = (body: unknown, playerId: string): ScoreBoardResponse => {
    const board = (body as Record<string, ScoreBoardResponse | undefined>)[playerId]
    if (!board) throw new Error(`점수판이 응답에 없다: ${playerId}`)
    return board
  }

  const candidates = (payload: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/games/${GAME_ID}/score-candidates`,
      headers: { 'content-type': 'application/json' },
      payload,
    })

  it('GET /rooms/{id}/scores — 12키를 null로 채워 내보낸다', async () => {
    await startGame('PLAYING', PLAYER_A, PLAYER_B)
    // 확정된 0점 하나 — 미기록(null)과 구분돼야 한다
    await redis().hset(gameScoreboardKey(GAME_ID, PLAYER_A), 'yacht', '0')

    const response = await get(`/rooms/${ROOM_CODE}/scores`)

    expect(response.statusCode).toBe(200)
    const body = response.json() as Record<string, ScoreBoardResponse>
    expect(Object.keys(body)).toEqual([PLAYER_A, PLAYER_B])
    expect(boardOf(body, PLAYER_A).categories.yacht).toBe(0)
    expect(boardOf(body, PLAYER_A).categories.ones).toBeNull()
    expect(boardOf(body, PLAYER_A).total).toBe(0)
    // 점수판 해시가 아예 없는 플레이어도 12키가 전부 있다(키 생략 금지)
    const empty = boardOf(body, PLAYER_B)
    expect(Object.keys(empty.categories)).toEqual([...SCORE_CATEGORIES])
    for (const category of SCORE_CATEGORIES) {
      expect(empty.categories[category]).toBeNull()
    }
    expect(empty).toMatchObject({ upperSubtotal: 0, upperBonus: 0, total: 0 })
    // 직렬화된 본문에서도 키가 살아 있어야 한다(undefined였다면 사라진다)
    expect(response.body).toContain('"ones":null')
  })

  it('GET /rooms/{id}/scores — 끝난 게임도 조회된다', async () => {
    await startGame('FINISHED', PLAYER_A)
    await setTotal(PLAYER_A, 120)

    const response = await get(`/rooms/${ROOM_CODE}/scores`)

    expect(response.statusCode).toBe(200)
    expect(boardOf(response.json(), PLAYER_A).total).toBe(120)
  })

  it('GET /rooms/{id}/results — 순위와 동점 여부를 돌려준다', async () => {
    await startGame('FINISHED', PLAYER_A, PLAYER_B, PLAYER_C)
    await setTotal(PLAYER_A, 200)
    await setTotal(PLAYER_B, 200)
    await setTotal(PLAYER_C, 100)

    const response = await get(`/rooms/${ROOM_CODE}/results`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      rankings: [
        { rank: 1, playerId: PLAYER_A, total: 200 },
        { rank: 1, playerId: PLAYER_B, total: 200 },
        { rank: 3, playerId: PLAYER_C, total: 100 },
      ],
      isTie: true,
    })
  })

  it('GET /rooms/{id}/results — 1위가 갈리면 isTie는 false다', async () => {
    await startGame('FINISHED', PLAYER_A, PLAYER_B, PLAYER_C)
    await setTotal(PLAYER_A, 200)
    await setTotal(PLAYER_B, 150)
    await setTotal(PLAYER_C, 150)

    const response = await get(`/rooms/${ROOM_CODE}/results`)

    expect(response.json()).toMatchObject({ isTie: false })
    expect(
      (response.json() as { rankings: { rank: number }[] }).rankings.map((r) => r.rank),
    ).toEqual([1, 2, 2])
  })

  it('인증 헤더가 없으면 401 AUTH_FAILED — 본문은 JSON이다', async () => {
    await startGame('PLAYING', PLAYER_A)

    const response = await get(`/rooms/${ROOM_CODE}/scores`, {})

    expect(response.statusCode).toBe(401)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.json()).toEqual({
      code: 'AUTH_FAILED',
      message: '유효하지 않은 사용자 세션입니다.',
    })
  })

  it('토큰이 틀리면 401 AUTH_FAILED다', async () => {
    await startGame('PLAYING', PLAYER_A)

    const response = await get(`/rooms/${ROOM_CODE}/scores`, {
      'X-User-Id': PLAYER_A,
      Authorization: 'Bearer 틀린-토큰',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('방 참가자가 아니면 403 NOT_IN_ROOM이다', async () => {
    await startGame('PLAYING', PLAYER_B)

    const response = await get(`/rooms/${ROOM_CODE}/scores`)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'NOT_IN_ROOM' })
  })

  it('없는 방은 404 ROOM_NOT_FOUND다', async () => {
    const response = await get('/rooms/NOPE/scores')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'ROOM_NOT_FOUND' })
  })

  it('시작 전 방은 409 GAME_NOT_STARTED다', async () => {
    await redis().hset(roomKey(ROOM_CODE), 'phase', 'LOBBY', 'capacity', '4')

    const response = await get(`/rooms/${ROOM_CODE}/scores`)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'GAME_NOT_STARTED' })
  })

  it('LOBBY로 되돌아간 방도 409 GAME_NOT_STARTED다', async () => {
    await startGame('LOBBY', PLAYER_A)

    const response = await get(`/rooms/${ROOM_CODE}/scores`)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'GAME_NOT_STARTED' })
  })

  it('끝나지 않은 게임의 결과는 409 GAME_NOT_FINISHED다', async () => {
    await startGame('PLAYING', PLAYER_A)

    const response = await get(`/rooms/${ROOM_CODE}/results`)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ code: 'GAME_NOT_FINISHED' })
  })

  it('방 상태가 깨졌으면 500 INTERNAL이다', async () => {
    await startGame('ARCHIVED', PLAYER_A)

    const response = await get(`/rooms/${ROOM_CODE}/scores`)

    expect(response.statusCode).toBe(500)
    expect(response.json()).toMatchObject({ code: 'INTERNAL' })
  })

  it('POST /games/{id}/score-candidates — 인증 없이 12키를 계산한다', async () => {
    const response = await candidates('{"dice":[3,3,3,5,5]}')

    expect(response.statusCode).toBe(200)
    const body = response.json() as { candidates: Record<string, number> }
    expect(body.candidates).toEqual({
      ones: 0,
      twos: 0,
      threes: 9,
      fours: 0,
      fives: 10,
      sixes: 0,
      choice: 19,
      fourOfAKind: 0,
      fullHouse: 19,
      smallStraight: 0,
      largeStraight: 0,
      yacht: 0,
    })
    // 키 순서·표기는 계약이다(내부 상수 이름이 새어 나오면 안 된다)
    expect(Object.keys(body.candidates)).toEqual([...SCORE_CATEGORIES])
    expect(response.body).not.toContain('FOUR_OF_A_KIND')
  })

  it('POST /games/{id}/score-candidates — 불충족 족보는 null이 아니라 0이다', async () => {
    const response = await candidates('{"dice":[1,2,3,4,6]}')

    const body = response.json() as { candidates: Record<string, number> }
    expect(body.candidates.yacht).toBe(0)
    expect(body.candidates.smallStraight).toBe(15)
    expect(body.candidates.largeStraight).toBe(0)
    expect(response.body).not.toContain('null')
  })

  it.each([
    ['dice 누락', '{}'],
    ['dice가 null', '{"dice":null}'],
    ['주사위 4개', '{"dice":[1,2,3,4]}'],
    ['주사위 6개', '{"dice":[1,2,3,4,5,6]}'],
    ['눈 0', '{"dice":[0,1,2,3,4]}'],
    ['눈 7', '{"dice":[1,2,3,4,7]}'],
    ['눈이 null', '{"dice":[1,2,null,4,5]}'],
    ['정수가 아닌 눈', '{"dice":[1,2,3,4,5.5]}'],
    ['깨진 JSON', '{"dice":[1,2,3,4,5]'],
  ])('POST /games/{id}/score-candidates — %s는 400이다', async (_name, payload) => {
    const response = await candidates(payload)

    expect(response.statusCode).toBe(400)
    expect(response.body).toBe('')
  })
})
