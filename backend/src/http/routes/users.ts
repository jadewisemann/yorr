import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { MemberUser } from '../../auth/socialProfile.js'
import { DomainError } from '../../errors.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import type { UserProfileService } from '../../user/profile.js'
import type { UserIdentity, UserService } from '../../user/session.js'
import { sendCode } from '../errorResponse.js'

/**
 * 내 프로필 — backend-java `user/controller/UserProfileController`.
 *
 * 인증은 **Bearer 토큰만**이다(방 REST의 `X-User-Id` + Bearer 2요소가 아니다) —
 * 프로필은 세션 토큰 하나로 신원이 유도되는 경로다(auth.md 「프로필 REST」).
 *
 * | 요청 | 응답 |
 * |---|---|
 * | `GET /users/me` | 200 `{userId, nickname, profileImageUrl}` · 401 `session_expired` · 403 `member_only` |
 * | `PATCH /users/me` `{nickname}` | 200 같은 모양 · 400 `invalid_nickname` · 404 `user_not_found` |
 */
export interface UserRouteDependencies {
  readonly users: UserService
  readonly profiles: UserProfileService
}

/** Java `ProfileResponse`가 직렬화되는 모양 그대로. camelCase다(방 REST의 snake_case가 아니다). */
const profileResponse = (user: MemberUser) => ({
  userId: user.id,
  nickname: user.nickname,
  profileImageUrl: user.profileImageUrl,
})

export const registerUserRoutes = async (
  app: FastifyInstance,
  deps: UserRouteDependencies,
): Promise<void> => {
  app.get('/users/me', async (request, reply) => {
    const member = await authenticateMember(deps, request, reply)
    if (member === undefined) return reply
    // 회원 행이 사라진 세션은 여기서 `UserNotFoundError`가 그대로 올라가 500이 된다.
    // Java도 같다 — GET은 read()의 IllegalArgumentException을 잡지 않는다(quirk 재현).
    return reply.code(200).send(profileResponse(await deps.profiles.read(member.userId)))
  })

  app.patch('/users/me', async (request, reply) => {
    const member = await authenticateMember(deps, request, reply)
    if (member === undefined) return reply
    const body = (request.body ?? {}) as { nickname?: unknown }
    const nickname = typeof body.nickname === 'string' ? body.nickname : null
    try {
      const renamed = await deps.profiles.rename(member.userId, nickname)
      return reply.code(200).send(profileResponse(renamed))
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      // Java: `user_not_found`만 404, 나머지(=`invalid_nickname`)는 400.
      // 기본값이 404인 공용 `sendDomainError`와 **갈래가 반대**라 여기서 직접 쓴다.
      return sendCode(reply, error.code === 'user_not_found' ? 404 : 400, error.code)
    }
  })
}

/**
 * 세션을 확인하고 **회원인지**까지 본다. 게스트 토큰은 401이 아니라 **403**이다 —
 * 인증은 됐지만 고칠 프로필 자체가 없는 상태라 다시 로그인해도 달라지지 않는다.
 * 클라이언트가 401(재로그인)과 403(불가)을 다르게 다뤄야 하므로 계약이다.
 *
 * 응답을 이미 보냈으면 `undefined`를 돌려준다.
 */
const authenticateMember = async (
  deps: UserRouteDependencies,
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

/** 헤더가 없거나 형식이 다르면 `undefined` — `authenticateSession`이 401로 판정한다. */
const bearerToken = (request: FastifyRequest): string | undefined => {
  const header = request.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !value.startsWith('Bearer ')) return undefined
  return value.slice('Bearer '.length)
}
