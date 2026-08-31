import type { FastifyInstance, FastifyReply } from 'fastify'
import { ConflictError, DomainError } from '../../errors.js'
import type { GameCatalog } from '../../game/catalog.js'
import type { QuickMatchService } from '../../room/quickMatchService.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import type { UserIdentity, UserService } from '../../user/session.js'
import { sendCode } from '../errorResponse.js'

/**
 * 퀵매치 REST.
 *
 * 오류 본문은 방 REST와 같은 **plain-text 문자열 코드**다(조회 REST(2.9)의 JSON
 * `{code,message}`와 섞지 않는다 — DESIGN.md 「오류 계약」). 다만 두 곳이 다르다:
 *
 * 1. **401 본문이 `unauthorized`** 다(방·봇은 `invalid_guest_session`). 프론트
 * userError 매핑이 API마다 다른 이 문자열들을 각각 알고 있다.
 * 2. `IllegalArgumentException` 갈래가 **전부 400**이다(방 REST는 기본이 404이고
 * `invalid_nickname`·`invalid_game_code`만 400). 그래서 공용
 * `sendDomainError`를 쓸 수 없고 `sendQuickMatchError`를 따로 둔다.
 */

export interface QuickMatchRouteDependencies {
  readonly users: UserService
  readonly catalog: GameCatalog
  readonly matches: QuickMatchService
}

/** 헤더는 중복되면 배열로 온다 — Java(@RequestHeader String)와 같이 첫 값만 본다. */
const header = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** 인증 실패만 401 `unauthorized`. 나머지는 그대로 올려 500이 된다(GET·DELETE의 계약). */
const sendUnauthorizedOnly = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof SessionAuthenticationError) return sendCode(reply, 401, 'unauthorized')
  throw error
}

/**
 * POST만 세 갈래를 잡는다. **`SessionAuthenticationError`가 `DomainError`의
 * 하위 타입**이므로 순서를 뒤집으면 401이 조용히 400으로 바뀐다.
 */
const sendQuickMatchError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof SessionAuthenticationError) return sendCode(reply, 401, 'unauthorized')
  if (error instanceof ConflictError) return sendCode(reply, 409, error.code)
  if (error instanceof DomainError) return sendCode(reply, 400, error.code)
  throw error
}

export const registerQuickMatchRoutes = async (
  app: FastifyInstance,
  deps: QuickMatchRouteDependencies,
): Promise<void> => {
  const { users, catalog, matches } = deps

  const authenticate = async (headers: Record<string, string | string[] | undefined>) =>
    users.authenticate(header(headers, 'x-user-id'), header(headers, 'authorization'))

  /**
   * 큐 입장. `game_code`가 없으면 야추다(Java `@RequestParam(defaultValue=…)`).
   * 코드 정규화(`canonicalCode`)가 인증 **뒤**에 오는 것도 Java와 같다 — 잘못된
   * 코드보다 만료된 세션이 먼저 보고된다.
   */
  app.post<{ Querystring: { game_code?: string } }>('/quick-matches', async (request, reply) => {
    try {
      const user: UserIdentity = await authenticate(request.headers)
      const gameCode = catalog.canonicalCode(request.query.game_code ?? 'YACHT_DICE')
      return reply.send(await matches.enter(user, gameCode))
    } catch (error) {
      return sendQuickMatchError(reply, error)
    }
  })

  /** 프론트가 1초마다 두드린다. **조회가 자동 시작을 굴린다**(quickMatchService.ts 참고). */
  app.get('/quick-matches', async (request, reply) => {
    try {
      const user = await authenticate(request.headers)
      return reply.send(await matches.status(user.userId))
    } catch (error) {
      return sendUnauthorizedOnly(reply, error)
    }
  })

  app.delete('/quick-matches', async (request, reply) => {
    try {
      const user = await authenticate(request.headers)
      return reply.send(await matches.cancel(user.userId))
    } catch (error) {
      return sendUnauthorizedOnly(reply, error)
    }
  })
}
