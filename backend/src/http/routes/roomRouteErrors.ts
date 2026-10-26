import type { FastifyReply } from 'fastify'
import { ConflictError, DomainError } from '../../errors.js'
import { ForbiddenError } from '../../room/botService.js'
import { sendCode } from '../errorResponse.js'

/**
 * 방 REST의 **오류 → 상태 코드 매핑**.
 *
 * 라우트 파일에서 갈라 둔 이유: 라우트별로 규칙이 미묘하게 다르고(아래 주석),
 * 그 차이가 계약이다. 매핑표를 한 파일에 모아 두면 "왜 봇 API만 400인가"를
 * 라우트 등록 코드와 섞지 않고 볼 수 있다.
 */

/** 방 API 공통 — 도메인 오류는 409, 그 밖은 500으로 올린다. */
export const sendConflictOnly = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof ConflictError) return sendCode(reply, 409, error.code)
  throw error
}

/**
 * 봇 API의 오류 매핑 — **방 API와 다르다**. 여기서는 `room_not_found`만 404이고
 * 나머지 `DomainError`는 400(`invalid_game_code`), `bot_not_found`만 409가 아닌
 * 404다. 라우트별로 다른 이 비일관성이 그대로 계약이다(DESIGN.md 「오류 계약」).
 */
export const sendBotError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof ForbiddenError) return sendCode(reply, 403, error.code)
  if (error instanceof DomainError) {
    return sendCode(reply, error.code === 'room_not_found' ? 404 : 400, error.code)
  }
  if (error instanceof ConflictError) {
    return sendCode(reply, error.code === 'bot_not_found' ? 404 : 409, error.code)
  }
  throw error
}
