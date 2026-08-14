import { randomUUID } from 'node:crypto'
import fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import type { WeeklyBest, WeeklyRankingRepository } from '../../../game/ranking/index.js'
import { MAX_LIMIT, WeeklyRankingService } from '../../../game/ranking/index.js'
import { UserService } from '../../../user/session.js'
import { registerRankingRoutes } from '../ranking.js'

/**
 * 이식: backend-java `RankingControllerTest` 전부.
 *
 * 세션은 진짜 Redis로 돈다 — 게스트/회원 구분이 이 라우트의 계약(403 vs 401)이고
 * 모킹으로는 지킬 수 없다(`users.test.ts`와 같은 방식). MySQL은 이 환경에 없으므로
 * 집계 저장소만 인메모리 가짜로 바꿔 끼운다. 라우트가 고정하는 것은 저장소가 아니라
 * **응답 계약**이다. 서비스는 진짜다 — limit 클램프·주 경계가 라우트를 지나 실제로
 * 걸리는지 보려면 가짜로 바꿔선 안 된다.
 */

interface WeeklyRankingBody {
  weekStart: string
  entries: Array<{ rank: number; userId: string; nickname: string; bestScore: number }>
}

interface MyWeeklyRankBody {
  weekStart: string
  rank: number
  bestScore: number
}

/** 2026-08-05(수) 12:00 KST — 주 시작은 2026-08-03(월)이다. */
const NOW = new Date('2026-08-05T03:00:00.000Z')

class FakeRankingRepository implements WeeklyRankingRepository {
  rows: readonly WeeklyBest[] = []
  myBest: number | undefined
  better = 0
  /** 라우트가 서비스에 넘긴 limit이 저장소까지 어떻게 도착했는지. */
  readonly limits: number[] = []

  async findWeeklyBest(_gameCode: string, _from: Date, _to: Date, limit: number) {
    this.limits.push(limit)
    return this.rows.slice(0, limit)
  }

  async findWeeklyBestScoreOf() {
    return this.myBest
  }

  async countMembersScoringMoreThan() {
    return this.better
  }
}

describeRedis('랭킹 REST', () => {
  const redis = useRedis()
  let app: FastifyInstance
  let users: UserService
  let participants: FakeRankingRepository

  const weekly = async (query = '') =>
    app.inject({ method: 'GET', url: `/api/v1/rankings/weekly${query}` })

  const myWeekly = async (token?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/rankings/weekly/me',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    })

  beforeEach(async () => {
    users = new UserService(redis())
    participants = new FakeRankingRepository()
    app = fastify({ logger: false })
    await app.register(
      async (api) =>
        registerRankingRoutes(api, {
          users,
          rankings: new WeeklyRankingService(participants, () => NOW),
        }),
      { prefix: '/api/v1' },
    )
    await app.ready()
  })

  afterEach(async () => {
    await app?.close()
  })

  describe('GET /rankings/weekly (무인증)', () => {
    /** 순위 번호는 응답을 만들 때 붙는다 — 서비스는 정렬된 점수만 준다. */
    it('순위와 주 시작일을 함께 돌려준다', async () => {
      participants.rows = [
        { userId: 'u1', nickname: '일등', bestScore: 300 },
        { userId: 'u2', nickname: '이등', bestScore: 250 },
      ]

      const response = await weekly()

      expect(response.statusCode).toBe(200)
      expect(response.json<WeeklyRankingBody>()).toEqual({
        weekStart: '2026-08-03',
        entries: [
          { rank: 1, userId: 'u1', nickname: '일등', bestScore: 300 },
          { rank: 2, userId: 'u2', nickname: '이등', bestScore: 250 },
        ],
      })
    })

    /**
     * 인증 헤더 없이 200이 나오는 것 자체가 "오르는 것은 회원만, 보는 것은 누구나"를
     * 지키고 있다는 확인이다 — 랜딩의 랭킹 티커가 비로그인 상태에서 이걸 읽는다.
     */
    it('토큰이 없어도 200이다', async () => {
      expect((await weekly()).statusCode).toBe(200)
      // 죽은 토큰을 들고 와도 목록은 막지 않는다.
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/rankings/weekly',
            headers: { authorization: 'Bearer 죽은토큰' },
          })
        ).statusCode,
      ).toBe(200)
    })

    it('아무도 없는 주는 빈 목록이다', async () => {
      expect((await weekly()).json<WeeklyRankingBody>()).toEqual({
        weekStart: '2026-08-03',
        entries: [],
      })
    })

    it('limit을 주지 않으면 상한만큼 요청한다', async () => {
      await weekly()

      expect(participants.limits).toEqual([MAX_LIMIT])
    })

    it('limit을 주면 그 값으로 요청한다', async () => {
      await weekly('?limit=10')

      expect(participants.limits).toEqual([10])
    })

    /** 클램프는 서비스가 한다 — 라우트는 값을 통과시킬 뿐이다. */
    it('limit은 [1,100]으로 잘린다', async () => {
      await weekly('?limit=1000')
      await weekly('?limit=0')
      await weekly('?limit=-3')

      expect(participants.limits).toEqual([MAX_LIMIT, 1, 1])
    })

    /**
     * Java는 `int limit`의 타입 변환 실패로 400을 낸다. 그 400의 본문은 Spring이
     * 만든 프레임워크 흔적이라 계약이 아니므로 빈 본문으로 맞춘다.
     */
    it('limit이 정수가 아니면 400이다', async () => {
      for (const query of ['?limit=abc', '?limit=1.5', '?limit=1e3', '?limit=열']) {
        const response = await weekly(query)
        expect([query, response.statusCode]).toEqual([query, 400])
      }
      expect(participants.limits).toEqual([])
    })

    /** 빈 값(`?limit=`)은 "주지 않은 것"으로 본다 — 400으로 막을 이유가 없다. */
    it('limit이 빈 값이면 기본값이다', async () => {
      expect((await weekly('?limit=')).statusCode).toBe(200)
      expect(participants.limits).toEqual([MAX_LIMIT])
    })
  })

  describe('GET /rankings/weekly/me', () => {
    let member: string
    let sessionToken: string

    beforeEach(async () => {
      member = randomUUID()
      sessionToken = await users.openMemberSession(member, '나')
    })

    it('내 순위를 돌려준다', async () => {
      participants.myBest = 184
      participants.better = 26

      const response = await myWeekly(sessionToken)

      expect(response.statusCode).toBe(200)
      expect(response.json<MyWeeklyRankBody>()).toEqual({
        weekStart: '2026-08-03',
        rank: 27,
        bestScore: 184,
      })
    })

    /** 빈 값을 200으로 주면 "0점 최하위"와 "아직 한 판도 안 했다"를 구분할 수 없다. */
    it('이번 주 기록이 없으면 204다', async () => {
      participants.myBest = undefined

      const response = await myWeekly(sessionToken)

      expect(response.statusCode).toBe(204)
      expect(response.body).toBe('')
    })

    it('0점 기록은 204가 아니라 200이다', async () => {
      participants.myBest = 0
      participants.better = 5

      const response = await myWeekly(sessionToken)

      expect(response.statusCode).toBe(200)
      expect(response.json<MyWeeklyRankBody>()).toMatchObject({ rank: 6, bestScore: 0 })
    })

    /** 게스트는 인증은 됐지만 오를 자리가 없다 — 다시 로그인해도 달라지지 않으므로 403이다. */
    it('게스트는 403 member_only(plain-text)다', async () => {
      const guest = await users.createGuest('손님')

      const response = await myWeekly(guest.sessionToken)

      expect(response.statusCode).toBe(403)
      expect(response.body).toBe('member_only')
      expect(response.headers['content-type']).toContain('text/plain')
    })

    /** 401 본문은 API마다 다르다 — 랭킹·프로필·auth는 `session_expired`다. */
    it('세션이 없거나 만료되면 401 session_expired(plain-text)다', async () => {
      const missing = await myWeekly()
      const wrong = await myWeekly('없는토큰')
      await users.closeSession(sessionToken)
      const closed = await myWeekly(sessionToken)

      for (const response of [missing, wrong, closed]) {
        expect(response.statusCode).toBe(401)
        expect(response.body).toBe('session_expired')
        expect(response.headers['content-type']).toContain('text/plain')
      }
    })

    it('Bearer 형식이 아닌 헤더도 401이다', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/rankings/weekly/me',
        headers: { authorization: sessionToken },
      })

      expect(response.statusCode).toBe(401)
      expect(response.body).toBe('session_expired')
    })
  })
})
