import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify'
import { ConflictError, DomainError } from '../errors.js'

/**
 * 방 REST의 오류 본문은 **JSON이 아니라 plain-text 문자열 코드**다
 * (`room_full`·`invalid_nickname` …). 프론트 `shared/api/client.ts`가
 * Content-Type이 JSON이 아니면 본문을 텍스트로 읽어 대문자 코드로 매핑한다 —
 * JSON 봉투로 감싸는 순간 그 매핑이 끊긴다(DESIGN.md 「오류 계약」).
 */
export const sendCode = (reply: FastifyReply, status: number, code: string): FastifyReply =>
  reply.code(status).type('text/plain; charset=utf-8').send(code)

/**
 * 도메인 오류를 HTTP 상태로 옮긴다.
 * **`invalid_nickname`·`invalid_game_code`만 400이고 나머지는 404**인 것이
 * 계약이다 — 방 REST의 의도된 비대칭이다.
 */
export const sendDomainError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof ConflictError) return sendCode(reply, 409, error.code)
  if (error instanceof DomainError) {
    const status =
      error.code === 'invalid_nickname' || error.code === 'invalid_game_code' ? 400 : 404
    return sendCode(reply, status, error.code)
  }
  throw error
}

/**
 * 4xx를 **빈 본문**으로 내보내는 오류 핸들러. 본문 없는 계산기 REST
 * (`score-candidates`·`ping-pong/ai-results`)가 쓴다.
 *
 * 이 계약이 필요한 이유는 Fastify가 스스로 만드는 4xx 때문이다. JSON 파싱 실패나
 * 미지원 Content-Type이 프레임워크 본문(`{statusCode,error,message}`)으로 나가면
 * 그 모양이 계약처럼 굳는다. 5xx는 그대로 흘려보내 원래 오류가 로그에 남게 한다.
 *
 * 반드시 **캡슐화된 하위 스코프**에 걸어야 한다 — 방 REST 등 다른 경로의 오류
 * 본문은 plain-text 코드이므로 여기 휘말리면 안 된다.
 */
export const sendEmptyClientErrors = (scope: FastifyInstance): void => {
  scope.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode ?? 500
    if (status < 500) return reply.code(status).send()
    return reply.send(error)
  })
}
