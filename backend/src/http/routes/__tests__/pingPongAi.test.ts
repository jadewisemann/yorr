import fastify, { type FastifyInstance } from 'fastify'
import type { Redis } from 'ioredis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import type { MatchArchiveInput } from '../../../game/match/index.js'
import {
  AI_PLAYER_ID,
  GUEST_NICKNAME,
  type PingPongAiResultArchive,
  PingPongAiResultService,
} from '../../../game/pingpong/index.js'
import { UserService } from '../../../user/session.js'
import { registerPingPongAiRoutes } from '../pingPongAi.js'

/**
 * 이식: 전부 + 오류 표면.
 *
 * 세션은 **진짜 Redis**로 돈다 — 이 라우트의 계약 절반이 "헤더가 없으면 게스트,
 * 있는데 틀리면 401"이고 그 판정은 세션 스토어를 지난다(`ranking.test.ts`·
 * `users.test.ts`와 같은 방식). MySQL은 이 환경에 없으므로 보관 포트만 기록용
 * 가짜로 바꿔 끼운다 — 라우트가 고정하는 것은 저장소가 아니라 **응답 계약**이고,
 * 실 MySQL 절반은 `game/pingpong/__tests__/aiResultArchive.test.ts`가 맡는다.
 */

const RESULT_ID = '4b72f136-f3c2-49c9-bfdb-290891fd8638'

class RecordingArchive implements PingPongAiResultArchive {
  readonly inputs: MatchArchiveInput[] = []
  saved = true

  async archiveParticipants(input: MatchArchiveInput): Promise<boolean> {
    this.inputs.push(input)
    return this.saved
  }
}

describeRedis('탁구 AI 결과 REST', () => {
  const redis = useRedis()
  let app: FastifyInstance
  let users: UserService
  let archive: RecordingArchive

  /** `payload`를 문자열로 주면 Content-Type을 직접 정할 수 있다. */
  const post = async (options: {
    body?: unknown
    raw?: string
    headers?: Record<string, string>
    contentType?: string | null
  }) => {
    const contentType = options.contentType === undefined ? 'application/json' : options.contentType
    return app.inject({
      method: 'POST',
      url: '/api/v1/games/ping-pong/ai-results',
      headers: {
        ...(contentType === null ? {} : { 'content-type': contentType }),
        ...options.headers,
      },
      payload: options.raw ?? (options.body === undefined ? '' : JSON.stringify(options.body)),
    })
  }

  const result = (overrides: Record<string, unknown> = {}) => ({
    resultId: RESULT_ID,
    humanScore: 11,
    aiScore: 7,
    ...overrides,
  })

  beforeEach(async () => {
    const client = redis() as Redis
    users = new UserService(client)
    archive = new RecordingArchive()
    app = fastify({ logger: false })
    await app.register(
      async (api) => {
        await registerPingPongAiRoutes(api, {
          users,
          results: new PingPongAiResultService(archive),
        })
        // 같은 스코프의 다른 라우트가 이 티켓의 파서·오류 핸들러에 오염되지 않는지.
        api.post('/rooms', async (request, reply) => reply.send({ body: request.body ?? null }))
      },
      { prefix: '/api/v1' },
    )
    await app.ready()
  })

  afterEach(async () => {
    await app?.close()
  })

  describe('보관 성공', () => {
    /** 이식: Java `로그인_회원의_결과를_저장한다`. */
    it('회원 세션의 결과를 그 계정으로 저장하고 204다', async () => {
      const token = await users.openMemberSession('member-1', '회원')

      const response = await post({ body: result(), headers: { authorization: `Bearer ${token}` } })

      expect(response.statusCode).toBe(204)
      expect(response.body).toBe('')
      expect(archive.inputs[0]).toMatchObject({
        gameId: RESULT_ID,
        gameCode: 'PING_PONG',
        roomCode: 'LOCAL_AI',
      })
      expect(archive.inputs[0]?.participants[0]).toMatchObject({
        playerId: 'member-1',
        displayNickname: '회원',
        totalScore: 11,
        ranking: 1,
      })
    })

    /** 이식: Java `비로그인_게스트의_결과를_저장한다`. */
    it('헤더가 없으면 게스트로 저장하고 204다', async () => {
      const response = await post({ body: result({ humanScore: 6, aiScore: 11 }) })

      expect(response.statusCode).toBe(204)
      const human = archive.inputs[0]?.participants[0]
      expect(human?.displayNickname).toBe(GUEST_NICKNAME)
      expect(human?.ranking).toBe(2)
      expect(archive.inputs[0]?.participants[1]).toMatchObject({
        playerId: AI_PLAYER_ID,
        ranking: 1,
      })
    })

    /** 빈 문자열·공백 헤더도 "안 보낸 것"이다(Java `isBlank`). */
    it.each(['', '   '])('공백 Authorization(%j)은 게스트로 본다', async (authorization) => {
      const response = await post({ body: result(), headers: { authorization } })

      expect(response.statusCode).toBe(204)
      expect(archive.inputs[0]?.participants[0]?.displayNickname).toBe(GUEST_NICKNAME)
    })

    /**
     * 이식: Java `기존_게스트_세션도_해당_UUID로_결과를_저장한다`.
     * 게스트 세션도 **자기 userId로** 남는다 — 라우트는 회원/게스트를 가르지 않고,
     * 그 판정은 4.4가 users 테이블로 한다.
     */
    it('게스트 세션은 자기 userId로 저장한다', async () => {
      const guest = await users.createGuest('손님')

      const response = await post({
        body: result(),
        headers: { authorization: `Bearer ${guest.sessionToken}` },
      })

      expect(response.statusCode).toBe(204)
      expect(archive.inputs[0]?.participants[0]).toMatchObject({
        playerId: guest.userId,
        displayNickname: '손님',
      })
    })

    /** 이미 보고된 판이라 저장되지 않아도 204다 — 멱등이지 실패가 아니다. */
    it('중복 보고도 204다', async () => {
      archive.saved = false

      expect((await post({ body: result() })).statusCode).toBe(204)
    })
  })

  describe('401 — 세션', () => {
    /** 이식: Java `잘못된_인증_헤더는_거절한다`. */
    it.each(['invalid', 'Bearer', 'bearer token', 'Basic abc', 'Bearer '])(
      'Authorization %j은 401 session_expired다',
      async (authorization) => {
        const response = await post({ body: result(), headers: { authorization } })

        expect(response.statusCode).toBe(401)
        expect(response.body).toBe('session_expired')
        expect(response.headers['content-type']).toBe('text/plain; charset=utf-8')
        // 인증이 막힌 요청은 보관 경로로 내려가지 않는다.
        expect(archive.inputs).toEqual([])
      },
    )

    it('죽은 토큰도 401 session_expired다', async () => {
      const response = await post({ body: result(), headers: { authorization: 'Bearer 죽은토큰' } })

      expect(response.statusCode).toBe(401)
      expect(response.body).toBe('session_expired')
      expect(archive.inputs).toEqual([])
    })

    /**
     * 401 본문은 라우트마다 다르다 — 퀵매치는 `unauthorized`, 방·봇은
     * `invalid_guest_session`, 여기(프로필·auth·랭킹과 같은 결)는 `session_expired`다.
     * `SessionAuthenticationError.code`가 `invalid_guest_session`이므로 그 값이
     * 새어 나오면 프론트 매핑이 어긋난다.
     */
    it('세션 오류 코드 원문이 새어 나오지 않는다', async () => {
      const response = await post({ body: result(), headers: { authorization: 'nope' } })

      expect(response.body).not.toContain('invalid_guest_session')
    })
  })

  describe('400 — 점수 재검증·UUID', () => {
    it.each([
      { body: result({ humanScore: 10, aiScore: 7 }), code: 'invalid_final_score' },
      { body: result({ humanScore: 11, aiScore: 10 }), code: 'invalid_final_score' },
      { body: result({ humanScore: -1, aiScore: 11 }), code: 'invalid_final_score' },
      { body: result({ resultId: 'not-a-uuid' }), code: 'invalid_result_id' },
      { body: { humanScore: 11, aiScore: 7 }, code: 'invalid_result_id' },
      { body: result({ resultId: null }), code: 'invalid_result_id' },
    ])('$code를 plain-text 400으로 돌려준다', async ({ body, code }) => {
      const response = await post({ body })

      expect(response.statusCode).toBe(400)
      expect(response.body).toBe(code)
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8')
      expect(archive.inputs).toEqual([])
    })

    /** 점수가 빠지면 0으로 바인딩돼 재검증에서 걸린다(Jackson primitive 기본값). */
    it('점수가 없는 본문은 invalid_final_score다', async () => {
      const response = await post({ body: { resultId: RESULT_ID } })

      expect(response.statusCode).toBe(400)
      expect(response.body).toBe('invalid_final_score')
    })

    /** Java는 `@RequestBody(required = false)`라 본문 없는 POST도 서비스까지 온다. */
    it.each([
      { label: '빈 본문 + JSON Content-Type', options: { raw: '' } },
      { label: 'Content-Type 없는 빈 본문', options: { raw: '', contentType: null } },
    ])('$label은 400 invalid_ai_result다', async ({ options }) => {
      const response = await post(options)

      expect(response.statusCode).toBe(400)
      expect(response.body).toBe('invalid_ai_result')
    })

    /**
     * 읽을 수 없는 본문은 도메인 오류가 아니다 — Spring이 만드는 400의 본문은
     * 프레임워크 흔적이라 계약이 아니므로 **빈 본문**으로 맞춘다
     * (`gameQueries.ts`의 score-candidates 400과 같은 판단).
     */
    it.each([
      { label: '깨진 JSON', options: { raw: '{oops' } },
      { label: '점수가 숫자가 아닌 본문', options: { body: result({ humanScore: 'abc' }) } },
      { label: '객체가 아닌 본문', options: { raw: '"plain"' } },
    ])('$label은 400 + 빈 본문이다', async ({ options }) => {
      const response = await post(options)

      expect(response.statusCode).toBe(400)
      expect(response.body).toBe('')
      expect(archive.inputs).toEqual([])
    })
  })

  /**
   * 이 라우트는 빈 본문을 통과시키려고 자기 하위 스코프에서 JSON 파서와 오류
   * 핸들러를 갈아 끼운다. 그 교체가 **같은 `/api/v1` 스코프의 다른 라우트로 새면**
   * 방 REST의 오류 계약이 조용히 바뀐다 — 캡슐화를 테스트로 못박는다.
   */
  it('파서·오류 핸들러 교체가 다른 라우트로 새지 않는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      headers: { 'content-type': 'application/json' },
      payload: '',
    })

    expect(response.statusCode).toBe(400)
    // Fastify 기본 파서의 오류 본문이 그대로 남아 있다(빈 본문으로 바뀌지 않았다).
    expect(response.json<{ code: string }>().code).toBe('FST_ERR_CTP_EMPTY_JSON_BODY')
  })
})
