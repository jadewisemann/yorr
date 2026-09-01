import type { FastifyReply, FastifyRequest } from 'fastify'
import { SessionAuthenticationError } from '../user/errors.js'
import type { UserIdentity, UserService } from '../user/session.js'
import { sendCode } from './errorResponse.js'

/**
 * `Authorization: Bearer …`에서 토큰만 꺼낸다. 헤더가 없거나 형식이 다르면
 * `undefined`이며 **던지지 않는다** — 판정은 `authenticateSession`이 한다.
 *
 * 헤더가 중복되면 배열로 오므로 첫 값만 본다.
 *
 * 탁구 AI 라우트에는 형식 위반을 **던지는** 다른 판본이 있다(`routes/pingPongAi.ts`).
 * 그쪽은 게스트를 허용하면서 깨진 헤더는 거절해야 해서 계약이 다르다.
 */
export const bearerToken = (request: FastifyRequest): string | undefined => {
  const header = request.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !value.startsWith('Bearer ')) return undefined
  return value.slice('Bearer '.length)
}

/**
 * 회원 전용 라우트의 앞단. 401과 403을 **가른다**: 세션이 만료된 것과, 인증은 됐지만
 * 게스트라 그 자리에 갈 수 없는 것은 클라이언트가 다르게 다뤄야 한다(재로그인이
 * 소용 있는가). 프로필은 "고칠 프로필이 없다", 랭킹은 "오를 자리가 없다"다.
 *
 * 응답을 이미 보냈으면 `undefined`를 돌려준다.
 */
export const authenticateMember = async (
  deps: { readonly users: UserService },
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<UserIdentity | undefined> => {
  let identity: UserIdentity
  try {
    identity = await deps.users.authenticateSession(bearerToken(request))
  } catch (error) {
    if (!(error instanceof SessionAuthenticationError)) throw error
    // 세션 계약의 본문은 API마다 다르다 — 프로필·auth·랭킹은 `session_expired`.
    sendCode(reply, 401, 'session_expired')
    return undefined
  }
  if (identity.type !== 'MEMBER') {
    sendCode(reply, 403, 'member_only')
    return undefined
  }
  return identity
}
