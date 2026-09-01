import type { FastifyInstance } from 'fastify'
import type { MemberUser } from '../../auth/socialProfile.js'
import { DomainError } from '../../errors.js'
import type { UserProfileService } from '../../user/profile.js'
import type { UserService } from '../../user/session.js'
import { sendCode } from '../errorResponse.js'
import { authenticateMember } from '../memberAuth.js'

/**
 * 내 프로필.
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

/** 프로필 응답의 직렬화 모양. camelCase다 — 방 REST의 snake_case가 아니다. */
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
    // 의도된 비대칭이다 — GET은 `read()`의 도메인 오류를 잡지 않는다(PATCH만 잡는다).
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
      // `user_not_found`만 404, 나머지(=`invalid_nickname`)는 400.
      // 기본값이 404인 공용 `sendDomainError`와 **갈래가 반대**라 여기서 직접 쓴다.
      return sendCode(reply, error.code === 'user_not_found' ? 404 : 400, error.code)
    }
  })
}
