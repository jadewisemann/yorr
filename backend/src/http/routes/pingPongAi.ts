import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify'
import { DomainError } from '../../errors.js'
import {
  bindPingPongAiResult,
  type PingPongAiResultService,
} from '../../game/pingpong/aiResultService.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import type { UserService } from '../../user/session.js'
import { sendCode } from '../errorResponse.js'

/**
 * 로컬 AI 탁구 결과 REST — backend-java `game/pingpong/PingPongAiResultController`.
 *
 * | 요청 | 응답 |
 * |---|---|
 * | `POST /games/ping-pong/ai-results` (헤더 없음) | **204** — 게스트로 보관 |
 * | 같은 경로 + `Authorization: Bearer <token>` | **204** — 그 세션의 주인으로 보관 |
 * | 잘못된 `Authorization` · 죽은 토큰 | **401** `session_expired` |
 * | UUID가 아닌 `resultId` | **400** `invalid_result_id` |
 * | 규칙으로 끝날 수 없는 점수 | **400** `invalid_final_score` |
 * | 본문 없음 | **400** `invalid_ai_result` |
 *
 * **`Authorization`이 선택인 유일한 REST**다. 온디바이스 AI와의 싱글플레이는
 * 로그인하지 않아도 할 수 있으므로, 헤더가 없다는 것은 오류가 아니라 "게스트다"라는
 * 뜻이다. 반대로 헤더가 **있는데 모양이 틀리면** 401이다 — 토큰을 들고 왔다는 것은
 * 자기 전적으로 남기려는 의도이고, 그것을 조용히 게스트로 떨어뜨리면 기록이 주인을
 * 잃는다(Java `bearerToken`이 blank는 null, 형식 위반은 예외로 가르는 이유).
 *
 * 오류 본문은 **plain-text 소문자 코드**다(프로필·auth·랭킹 REST와 같은 결).
 * 조회 REST(2.9)의 JSON `{code,message}`가 아니고, 401 본문은 퀵매치의
 * `unauthorized`도 방 REST의 `invalid_guest_session`도 아닌 **`session_expired`** 다 —
 * Java가 그 리터럴을 그대로 쓰고 프론트 `shared/api/client.ts`가 본문을 텍스트로
 * 읽어 대문자 코드로 매핑한다. 라우트마다 다른 이 문자열들이 계약이므로 섞지 않는다.
 */

export interface PingPongAiRouteDependencies {
  readonly users: UserService
  readonly results: PingPongAiResultService
}

/**
 * `SessionAuthenticationError`가 `DomainError`의 **하위 타입**이므로 순서를 뒤집으면
 * 401이 조용히 400으로 바뀐다(`quickMatch.ts`와 같은 함정).
 */
const sendAiResultError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof SessionAuthenticationError) return sendCode(reply, 401, 'session_expired')
  if (error instanceof DomainError) return sendCode(reply, 400, error.code)
  throw error
}

/**
 * Java `bearerToken`: 헤더가 없거나 공백이면 **게스트**(null), 있는데
 * `Bearer ` 접두사가 없거나 토큰이 빈 문자열이면 401이다.
 *
 * @returns 세션 토큰, 또는 게스트를 뜻하는 `undefined`
 * @throws SessionAuthenticationError 형식이 틀린 헤더
 */
const bearerToken = (header: string | string[] | undefined): string | undefined => {
  // 헤더가 중복되면 배열로 온다 — Java(@RequestHeader String)와 같이 첫 값만 본다.
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || value.trim().length === 0) return undefined
  if (!value.startsWith('Bearer ') || value.length === 'Bearer '.length) {
    throw new SessionAuthenticationError()
  }
  return value.slice('Bearer '.length)
}

export const registerPingPongAiRoutes = async (
  app: FastifyInstance,
  deps: PingPongAiRouteDependencies,
): Promise<void> => {
  /**
   * 캡슐화된 하위 스코프 — `gameQueries.ts`의 score-candidates와 같은 이유다.
   *
   * ① Java는 `@RequestBody(required = false)`라 **본문 없는 POST도 핸들러까지
   * 들어와** `invalid_ai_result`를 만든다. Fastify 기본 JSON 파서는 그 전에
   * `FST_ERR_CTP_EMPTY_JSON_BODY`(400 + 프레임워크 JSON)를 던지므로, 이 스코프에서만
   * 빈 본문을 `undefined`로 통과시키는 파서로 바꾼다. ② 읽을 수 없는 본문의 4xx는
   * **빈 본문**으로 내보낸다 — `{statusCode,error,message}`가 계약처럼 굳지 않게.
   *
   * 파서·오류 핸들러 모두 이 스코프 밖(방·퀵매치·조회 REST)에는 영향이 없다.
   */
  await app.register(async (scope) => {
    scope.removeContentTypeParser(['application/json'])
    scope.addContentTypeParser<string>(
      '*',
      { parseAs: 'string' },
      (_request, body, done: (error: Error | null, value?: unknown) => void) => {
        if (typeof body !== 'string' || body.trim().length === 0) return done(null, undefined)
        try {
          done(null, JSON.parse(body))
        } catch {
          const error = new Error('malformed_json') as FastifyError
          error.statusCode = 400
          done(error)
        }
      },
    )

    scope.setErrorHandler((error: FastifyError, _request, reply) => {
      const status = error.statusCode ?? 500
      if (status < 500) return reply.code(status).send()
      return reply.send(error)
    })

    scope.post<{ Body: unknown }>('/games/ping-pong/ai-results', async (request, reply) => {
      const binding = bindPingPongAiResult(request.body)
      if (!binding.ok) return reply.code(400).send()
      try {
        const token = bearerToken(request.headers.authorization)
        // 세션이 없으면 임의 UUID로 남긴다 — 회원/게스트를 가르는 것은 이 헤더가
        // 아니라 4.4의 users 테이블 조회다(게스트 세션도 `archive` 쪽으로 간다).
        if (token === undefined) await deps.results.archiveGuest(binding.request)
        else {
          const user = await deps.users.authenticateSession(token)
          await deps.results.archive(user, binding.request)
        }
        // 이미 보고된 resultId여서 저장되지 않았어도 204다 — 멱등이지 실패가 아니다.
        return reply.code(204).send()
      } catch (error) {
        return sendAiResultError(reply, error)
      }
    })
  })
}
