import type { FastifyReply } from 'fastify'
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
 * Java 컨트롤러의 `catch (IllegalArgumentException) → 400/404` +
 * `catch (IllegalStateException) → 409`를 그대로 옮긴 것.
 * **`invalid_nickname`·`invalid_game_code`만 400이고 나머지는 404**인 것이
 * 계약이다(quirk — RoomController).
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
