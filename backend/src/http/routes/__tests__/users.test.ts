import { randomUUID } from 'node:crypto'
import fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { type MemberUser, PLACEHOLDER_NICKNAME } from '../../../auth/socialProfile.js'
import {
  UserNotFoundError,
  type UserProfileRepository,
  UserProfileService,
} from '../../../user/profile.js'
import { UserService } from '../../../user/session.js'
import { registerUserRoutes } from '../users.js'

/**
 * 프로필 REST.
 *
 * 세션은 진짜 Redis로 돈다(게스트/회원 구분·TTL이 계약이라 모킹으로는 못 지킨다).
 * MySQL은 이 환경에 없으므로 회원 저장소만 인메모리 가짜로 바꿔 끼운다 — 라우트가
 * 고정하는 것은 저장소가 아니라 **응답 계약**이다(auth.test.ts와 같은 방식).
 */

interface ProfileResponse {
  userId: string
  nickname: string
  profileImageUrl: string | null
}

class FakeUserProfiles implements UserProfileRepository {
  private readonly rows = new Map<string, MemberUser>()

  seed(user: MemberUser): MemberUser {
    this.rows.set(user.id, user)
    return user
  }

  async findById(userId: string): Promise<MemberUser | undefined> {
    return this.rows.get(userId)
  }

  async rename(userId: string, nickname: string): Promise<MemberUser> {
    const current = this.rows.get(userId)
    if (current === undefined) throw new UserNotFoundError()
    const renamed: MemberUser = { ...current, nickname }
    this.rows.set(userId, renamed)
    return renamed
  }
}

describeRedis('프로필 REST', () => {
  const redis = useRedis()
  let app: FastifyInstance
  let users: UserService
  let profiles: FakeUserProfiles
  let member: MemberUser
  let sessionToken: string

  const get = async (token?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    })

  const patch = async (token: string | undefined, payload: unknown) =>
    app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      payload: payload as never,
    })

  beforeEach(async () => {
    users = new UserService(redis())
    profiles = new FakeUserProfiles()
    member = profiles.seed({
      id: randomUUID(),
      nickname: PLACEHOLDER_NICKNAME,
      profileImageUrl: 'https://img/1',
    })
    sessionToken = await users.openMemberSession(member.id, member.nickname)
    app = fastify({ logger: false })
    await app.register(
      async (api) =>
        registerUserRoutes(api, {
          users,
          profiles: new UserProfileService(profiles, users),
        }),
      { prefix: '/api/v1' },
    )
    await app.ready()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('GET /users/me — 200 {userId, nickname, profileImageUrl}', async () => {
    const response = await get(sessionToken)

    expect(response.statusCode).toBe(200)
    expect(response.json<ProfileResponse>()).toEqual({
      userId: member.id,
      nickname: PLACEHOLDER_NICKNAME,
      profileImageUrl: 'https://img/1',
    })
  })

  /** 동의하지 않으면 사진을 받을 수 없다 — 클라이언트가 닉네임 첫 글자 아바타로 대신한다. */
  it('프로필 사진이 없으면 profileImageUrl은 null이다', async () => {
    const bare = profiles.seed({ id: randomUUID(), nickname: '사진없음', profileImageUrl: null })
    const token = await users.openMemberSession(bare.id, bare.nickname)

    expect((await get(token)).json<ProfileResponse>().profileImageUrl).toBeNull()
  })

  it('토큰이 없거나 죽었으면 401 session_expired(plain-text)다', async () => {
    const missing = await get()
    const wrong = await get('nope')
    await users.closeSession(sessionToken)
    const closed = await get(sessionToken)

    for (const response of [missing, wrong, closed]) {
      expect(response.statusCode).toBe(401)
      expect(response.body).toBe('session_expired')
      expect(String(response.headers['content-type'])).toContain('text/plain')
    }
  })

  /** 게스트는 인증은 되지만 고칠 프로필이 없다 — 401(재로그인)과 구분되는 403이다. */
  it('게스트 세션은 403 member_only다', async () => {
    const guest = await users.createGuest('게스트')

    const read = await get(guest.sessionToken)
    const write = await patch(guest.sessionToken, { nickname: '바꿔보기' })

    expect(read.statusCode).toBe(403)
    expect(read.body).toBe('member_only')
    expect(String(read.headers['content-type'])).toContain('text/plain')
    expect(write.statusCode).toBe(403)
    expect(write.body).toBe('member_only')
  })

  it('PATCH /users/me — 200이고 DB·세션이 함께 바뀐다', async () => {
    const response = await patch(sessionToken, { nickname: '새이름' })

    expect(response.statusCode).toBe(200)
    expect(response.json<ProfileResponse>()).toEqual({
      userId: member.id,
      nickname: '새이름',
      profileImageUrl: 'https://img/1',
    })
    // dual-write: 다음 GET(=DB)과 세션 인증이 둘 다 새 이름이어야 한다.
    expect((await get(sessionToken)).json<ProfileResponse>().nickname).toBe('새이름')
    expect((await users.authenticateSession(sessionToken)).nickname).toBe('새이름')
  })

  it('빈 이름·20자 초과·nickname 없음은 400 invalid_nickname이고 아무것도 바뀌지 않는다', async () => {
    const blank = await patch(sessionToken, { nickname: '   ' })
    const tooLong = await patch(sessionToken, { nickname: '가'.repeat(21) })
    const absent = await patch(sessionToken, {})

    for (const response of [blank, tooLong, absent]) {
      expect(response.statusCode).toBe(400)
      expect(response.body).toBe('invalid_nickname')
      expect(String(response.headers['content-type'])).toContain('text/plain')
    }
    expect((await get(sessionToken)).json<ProfileResponse>().nickname).toBe(PLACEHOLDER_NICKNAME)
    expect((await users.authenticateSession(sessionToken)).nickname).toBe(PLACEHOLDER_NICKNAME)
  })

  /** 세션은 살아 있는데 회원 행이 사라진 상태. 닉네임 규칙 위반(400)과 구분해 알린다. */
  it('PATCH는 회원 행이 없으면 404 user_not_found다', async () => {
    const ghost = await users.openMemberSession(randomUUID(), '유령')

    const response = await patch(ghost, { nickname: '새이름' })

    expect(response.statusCode).toBe(404)
    expect(response.body).toBe('user_not_found')
  })

  it('회원 행이 없어도 이름이 잘못됐으면 400이 이긴다(정규화가 먼저다)', async () => {
    const ghost = await users.openMemberSession(randomUUID(), '유령')

    const response = await patch(ghost, { nickname: '' })

    expect(response.statusCode).toBe(400)
    expect(response.body).toBe('invalid_nickname')
  })

  /**
   * 의도된 비대칭: GET은 `read()`의 `user_not_found`를 잡지 않는다(PATCH만 잡는다).
   * Spring에서는 처리되지 않은 `IllegalArgumentException`이 500이 되고, 여기서도
   * Fastify 기본 처리로 500이다. **비대칭 자체가 계약**이라 통일하지 않았다.
   */
  it('GET은 회원 행이 없으면 404가 아니라 500이다(Java와 같은 비대칭)', async () => {
    const ghost = await users.openMemberSession(randomUUID(), '유령')

    const response = await get(ghost)

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toBe('user_not_found')
  })

  /** 개명은 플레이스홀더 상태를 해제한다 — 이후 로그인이 제공자 이름으로 덮지 않는다. */
  it('직접 개명하면 플레이스홀더가 아니게 된다', async () => {
    await patch(sessionToken, { nickname: '내가정한이름' })

    expect((await get(sessionToken)).json<ProfileResponse>().nickname).not.toBe(
      PLACEHOLDER_NICKNAME,
    )
  })
})
