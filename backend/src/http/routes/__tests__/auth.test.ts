import fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../../test/redisHarness.js'
import { authOptions } from '../../../auth/config.js'
import { DataIntegrityViolationError } from '../../../auth/errors.js'
import { GoogleOAuthClient } from '../../../auth/googleClient.js'
import { KakaoOAuthClient } from '../../../auth/kakaoClient.js'
import { LoginCodeStore } from '../../../auth/loginCodeStore.js'
import type { FetchLike } from '../../../auth/oauthHttp.js'
import type {
  SocialAccountRegistrar,
  SocialAccountRepository,
} from '../../../auth/socialAccountStore.js'
import { SocialLoginService } from '../../../auth/socialLoginService.js'
import {
  type MemberUser,
  PLACEHOLDER_NICKNAME,
  type SocialProvider,
} from '../../../auth/socialProfile.js'
import { OAuthStateStore } from '../../../auth/stateStore.js'
import { loadEnv } from '../../../config/env.js'
import { UserService } from '../../../user/session.js'
import { registerAuthRoutes } from '../auth.js'

/**
 * 소셜 로그인 REST.
 *
 * 세션·state·로그인 코드는 진짜 Redis로 돈다(1회용 시맨틱과 TTL이 계약이라
 * 모킹으로는 못 지킨다). MySQL은 이 환경에 없으므로 회원 저장소만 인메모리
 * 가짜로 바꿔 끼운다 — 라우트가 고정하는 것은 저장소가 아니라 **응답 계약**이다.
 */

const FRONTEND = 'http://localhost:5173/auth/callback'

const ENV = {
  AUTH_FRONTEND_REDIRECT_URI: FRONTEND,
  KAKAO_CLIENT_ID: 'rest-api-key',
  KAKAO_CLIENT_SECRET: 'kakao-secret',
  KAKAO_REDIRECT_URI: 'http://localhost:8080/api/v1/auth/kakao/callback',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:8080/api/v1/auth/google/callback',
}

/** users·social_accounts를 대신하는 인메모리 저장소. 유니크 제약까지 흉내 낸다. */
class FakeSocialAccounts implements SocialAccountRepository, SocialAccountRegistrar {
  private readonly users = new Map<string, MemberUser>()
  private readonly links = new Map<string, string>()
  private sequence = 0

  async findUserByProviderAccount(
    provider: SocialProvider,
    providerUserId: string,
  ): Promise<MemberUser | undefined> {
    const userId = this.links.get(`${provider}:${providerUserId}`)
    return userId === undefined ? undefined : this.users.get(userId)
  }

  async register(
    provider: SocialProvider,
    providerUserId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser> {
    const key = `${provider}:${providerUserId}`
    if (this.links.has(key)) throw new DataIntegrityViolationError('duplicate')
    this.sequence += 1
    const user: MemberUser = { id: `member-${this.sequence}`, nickname, profileImageUrl }
    this.users.set(user.id, user)
    this.links.set(key, user.id)
    return user
  }

  async adoptProviderProfile(
    userId: string,
    nickname: string,
    profileImageUrl: string | null,
  ): Promise<MemberUser> {
    const current = this.users.get(userId)
    if (current === undefined) throw new Error(`user_not_found: ${userId}`)
    const adopted: MemberUser = { id: userId, nickname, profileImageUrl }
    this.users.set(userId, adopted)
    return adopted
  }
}

interface SessionResponse {
  userId: string
  nickname: string
  type: string
  sessionToken: string | null
}

describeRedis('소셜 로그인 REST', () => {
  const redis = useRedis()
  let app: FastifyInstance
  let accounts: FakeSocialAccounts
  let providerResponses: Response[]

  /** 제공자 호출은 큐에 넣어 둔 응답을 순서대로 돌려준다(네트워크 없음). */
  const providerFetch: FetchLike = async (url) => {
    const next = providerResponses.shift()
    if (next === undefined) throw new Error(`예상하지 않은 제공자 호출: ${url}`)
    return next
  }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const build = async (overrides: Record<string, string> = {}): Promise<FastifyInstance> => {
    const env = loadEnv({ ...ENV, ...overrides })
    const options = authOptions(env)
    const instance = fastify({ logger: false })
    await instance.register(
      async (api) =>
        registerAuthRoutes(api, {
          users: new UserService(redis()),
          options,
          kakao: new KakaoOAuthClient(options.kakao, { fetch: providerFetch }),
          google: new GoogleOAuthClient(options.google, { fetch: providerFetch }),
          state: new OAuthStateStore(redis()),
          loginCodes: new LoginCodeStore(redis()),
          logins: new SocialLoginService(accounts, accounts),
        }),
      { prefix: '/api/v1' },
    )
    await instance.ready()
    return instance
  }

  /** authorize → 제공자 → callback을 한 번 통과시키고 프론트로 가는 URL을 돌려준다. */
  const login = async (
    provider = 'kakao',
    profile: unknown = { id: 1234567890, kakao_account: { profile: { nickname: '카카오닉' } } },
  ): Promise<URL> => {
    const started = await app.inject({ method: 'GET', url: `/api/v1/auth/${provider}/authorize` })
    const state = new URL(String(started.headers.location)).searchParams.get('state')
    providerResponses.push(json({ access_token: 'access-1' }), json(profile))
    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/${provider}/callback?code=auth-code&state=${state}`,
    })
    expect(callback.statusCode).toBe(302)
    return new URL(String(callback.headers.location))
  }

  const exchange = async (code: string): Promise<{ statusCode: number; body: string }> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/session',
      payload: { code },
    })
    return { statusCode: response.statusCode, body: response.body }
  }

  beforeEach(async () => {
    accounts = new FakeSocialAccounts()
    providerResponses = []
    app = await build()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('GET /auth/kakao/authorize — 동의 화면으로 302하고 state를 남긴다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/kakao/authorize' })

    expect(response.statusCode).toBe(302)
    const location = new URL(String(response.headers.location))
    expect(location.origin + location.pathname).toBe('https://kauth.kakao.com/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('rest-api-key')
    expect(location.searchParams.get('prompt')).toBeNull()
    // 발급된 state가 실제로 Redis에 있어야 콜백이 통과한다.
    const state = String(location.searchParams.get('state'))
    expect(await redis().exists(`auth:oauth-state:${state}`)).toBe(1)
  })

  it('prompt는 제공자별 문자열이 정확히 맞을 때만 전달된다', async () => {
    const kakao = await app.inject({ url: '/api/v1/auth/kakao/authorize?prompt=login' })
    const kakaoOther = await app.inject({
      url: '/api/v1/auth/kakao/authorize?prompt=select_account',
    })
    const google = await app.inject({ url: '/api/v1/auth/google/authorize?prompt=select_account' })

    expect(String(kakao.headers.location)).toContain('prompt=login')
    expect(String(kakaoOther.headers.location)).not.toContain('prompt=')
    expect(String(google.headers.location)).toContain('prompt=select_account')
    expect(String(google.headers.location)).toContain('scope=openid+profile+email')
  })

  /** 설정이 없으면 리다이렉트할 곳도 없다 — 브라우저가 직접 여는 주소라 상태 코드로 알린다. */
  it('미설정 제공자는 503 빈 본문이다', async () => {
    await app.close()
    app = await build({ KAKAO_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' })

    const kakao = await app.inject({ url: '/api/v1/auth/kakao/authorize' })
    const google = await app.inject({ url: '/api/v1/auth/google/authorize' })

    expect(kakao.statusCode).toBe(503)
    expect(kakao.body).toBe('')
    expect(google.statusCode).toBe(503)
  })

  it('콜백은 가입·세션 개설 후 일회용 코드를 달고 프론트로 302한다', async () => {
    const redirect = await login()

    expect(`${redirect.origin}${redirect.pathname}`).toBe(FRONTEND)
    const code = String(redirect.searchParams.get('code'))
    expect(code).not.toBe('')
    // 세션 토큰은 URL에 실리지 않는다 — 히스토리·리퍼러·액세스 로그에 남기지 않기 위해서다.
    expect(redirect.searchParams.get('sessionToken')).toBeNull()

    const exchanged = await exchange(code)
    expect(exchanged.statusCode).toBe(200)
    const session = JSON.parse(exchanged.body) as SessionResponse
    expect(session.nickname).toBe('카카오닉')
    expect(session.type).toBe('MEMBER')
    expect(session.sessionToken).not.toBe('')
  })

  it('로그인 코드는 한 번만 교환된다', async () => {
    const code = String((await login()).searchParams.get('code'))

    expect((await exchange(code)).statusCode).toBe(200)
    const replay = await exchange(code)

    expect(replay.statusCode).toBe(401)
    expect(replay.body).toBe('invalid_login_code')
  })

  it('없는 코드는 401 invalid_login_code다', async () => {
    const response = await exchange('nope')

    expect(response.statusCode).toBe(401)
    expect(response.body).toBe('invalid_login_code')
  })

  it('같은 소셜 계정으로 다시 로그인하면 같은 회원이다', async () => {
    const first = JSON.parse(
      (await exchange(String((await login()).searchParams.get('code')))).body,
    ) as SessionResponse
    const second = JSON.parse(
      (await exchange(String((await login()).searchParams.get('code')))).body,
    ) as SessionResponse

    expect(second.userId).toBe(first.userId)
    // 재로그인은 tokenHash를 덮어쓴다 → 계정당 라이브 세션 1개.
    expect(second.sessionToken).not.toBe(first.sessionToken)
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${first.sessionToken}` },
    })
    expect(stale.statusCode).toBe(401)
  })

  /** 동의항목이 꺼진 채 가입한 회원이 나중에 진짜 이름을 주면 그때 받아 적는다. */
  it('플레이스홀더로 가입한 회원은 다음 로그인에서 이름을 채택한다', async () => {
    await login('kakao', { id: 7 })
    const named = await login('kakao', {
      id: 7,
      kakao_account: { profile: { nickname: '진짜닉' } },
    })

    const session = JSON.parse(
      (await exchange(String(named.searchParams.get('code')))).body,
    ) as SessionResponse
    expect(session.nickname).toBe('진짜닉')
    expect(session.nickname).not.toBe(PLACEHOLDER_NICKNAME)
  })

  it('사용자가 취소하면 error=canceled로 프론트에 돌려보낸다', async () => {
    const response = await app.inject({
      url: '/api/v1/auth/kakao/callback?error=access_denied&state=whatever',
    })

    expect(response.statusCode).toBe(302)
    expect(new URL(String(response.headers.location)).searchParams.get('error')).toBe('canceled')
  })

  it('우리가 발급하지 않은 state는 error=invalid_state다', async () => {
    const response = await app.inject({
      url: '/api/v1/auth/kakao/callback?code=c&state=forged',
    })

    expect(new URL(String(response.headers.location)).searchParams.get('error')).toBe(
      'invalid_state',
    )
  })

  /** 같은 콜백 URL을 다시 여는 것이 통하면 로그인 CSRF 방어가 무의미해진다. */
  it('같은 state를 두 번 쓰면 두 번째는 invalid_state다', async () => {
    const started = await app.inject({ url: '/api/v1/auth/kakao/authorize' })
    const state = new URL(String(started.headers.location)).searchParams.get('state')
    providerResponses.push(json({ access_token: 'a' }), json({ id: 1 }))
    await app.inject({ url: `/api/v1/auth/kakao/callback?code=c&state=${state}` })

    const replay = await app.inject({ url: `/api/v1/auth/kakao/callback?code=c&state=${state}` })

    expect(new URL(String(replay.headers.location)).searchParams.get('error')).toBe('invalid_state')
  })

  it('state는 유효한데 code가 없으면 provider_error다', async () => {
    const started = await app.inject({ url: '/api/v1/auth/kakao/authorize' })
    const state = new URL(String(started.headers.location)).searchParams.get('state')

    const response = await app.inject({ url: `/api/v1/auth/kakao/callback?state=${state}` })

    expect(new URL(String(response.headers.location)).searchParams.get('error')).toBe(
      'provider_error',
    )
  })

  it('제공자 호출이 실패해도 본문 대신 provider_error만 프론트로 간다', async () => {
    const started = await app.inject({ url: '/api/v1/auth/kakao/authorize' })
    const state = new URL(String(started.headers.location)).searchParams.get('state')
    providerResponses.push(json({ error_description: 'client_secret=super-secret' }, 401))

    const response = await app.inject({ url: `/api/v1/auth/kakao/callback?code=c&state=${state}` })

    const location = String(response.headers.location)
    expect(new URL(location).searchParams.get('error')).toBe('provider_error')
    expect(location).not.toContain('super-secret')
  })

  /**
   * 프론트가 여러 출처에서 도는 구성(운영 도메인 + Vercel 기본 주소 + 로컬)에서
   * **로그인을 시작한 출처로** 돌아와야 한다. 다른 출처로 돌려보내면 세션이
   * 그쪽 `localStorage`에 저장돼 사용자에게는 로그인 실패로 보인다.
   */
  describe('복귀 출처 (origin 파라미터)', () => {
    const VERCEL = 'https://yorr-eight.vercel.app'

    const useMultiOrigin = async (): Promise<void> => {
      await app.close()
      app = await build({ CORS_ALLOWED_ORIGINS: `http://localhost:5173,${VERCEL}` })
    }

    /** state에 담긴 복귀 주소를 따라간다 — 제공자 콜백은 그대로 한 곳으로 온다. */
    it('허용 목록에 있는 출처에서 시작하면 그 출처로 돌아온다', async () => {
      await useMultiOrigin()
      const started = await app.inject({
        url: `/api/v1/auth/kakao/authorize?origin=${encodeURIComponent(VERCEL)}`,
      })
      const state = new URL(String(started.headers.location)).searchParams.get('state')
      providerResponses.push(json({ access_token: 'a' }), json({ id: 11 }))

      const response = await app.inject({
        url: `/api/v1/auth/kakao/callback?code=c&state=${state}`,
      })

      const location = new URL(String(response.headers.location))
      expect(location.origin + location.pathname).toBe(`${VERCEL}/auth/callback`)
      expect(location.searchParams.get('code')).not.toBeNull()
    })

    it('실패도 시작한 출처로 돌아온다 — 안내 문구를 볼 화면이 거기 있다', async () => {
      await useMultiOrigin()
      const started = await app.inject({
        url: `/api/v1/auth/google/authorize?origin=${encodeURIComponent(VERCEL)}`,
      })
      const state = new URL(String(started.headers.location)).searchParams.get('state')
      providerResponses.push(json({ error: 'nope' }, 401))

      const response = await app.inject({
        url: `/api/v1/auth/google/callback?code=c&state=${state}`,
      })

      const location = new URL(String(response.headers.location))
      expect(location.origin + location.pathname).toBe(`${VERCEL}/auth/callback`)
      expect(location.searchParams.get('error')).toBe('provider_error')
    })

    it('목록에 없는 출처는 무시하고 설정된 복귀 주소로 돌아온다', async () => {
      await useMultiOrigin()
      const started = await app.inject({
        url: '/api/v1/auth/kakao/authorize?origin=https%3A%2F%2Fevil.example',
      })
      const state = new URL(String(started.headers.location)).searchParams.get('state')
      providerResponses.push(json({ access_token: 'a' }), json({ id: 12 }))

      const response = await app.inject({
        url: `/api/v1/auth/kakao/callback?code=c&state=${state}`,
      })

      const location = new URL(String(response.headers.location))
      expect(location.origin + location.pathname).toBe(FRONTEND)
    })

    /** state를 못 꺼낸 콜백은 시작 출처를 알 길이 없다 — 설정값으로 보낸다. */
    it('state가 없으면 설정된 복귀 주소로 invalid_state를 알린다', async () => {
      await useMultiOrigin()

      const response = await app.inject({ url: '/api/v1/auth/kakao/callback?code=c' })

      const location = new URL(String(response.headers.location))
      expect(location.origin + location.pathname).toBe(FRONTEND)
      expect(location.searchParams.get('error')).toBe('invalid_state')
    })
  })

  it('GET /auth/me — 살아 있는 세션은 200, 죽은 세션은 401 session_expired다', async () => {
    const session = JSON.parse(
      (await exchange(String((await login()).searchParams.get('code')))).body,
    ) as SessionResponse

    const alive = await app.inject({
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session.sessionToken}` },
    })
    const missing = await app.inject({ url: '/api/v1/auth/me' })
    const wrong = await app.inject({
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer nope' },
    })

    expect(alive.statusCode).toBe(200)
    const body = alive.json() as SessionResponse
    expect(body.userId).toBe(session.userId)
    expect(body.type).toBe('MEMBER')
    // 교환 때만 토큰을 싣는다 — /me는 이미 토큰을 가진 쪽이 묻는 것이다.
    expect(body.sessionToken).toBeNull()
    expect(missing.statusCode).toBe(401)
    expect(missing.body).toBe('session_expired')
    expect(String(missing.headers['content-type'])).toContain('text/plain')
    expect(wrong.statusCode).toBe(401)
  })

  /** 여기서 유효·무효를 구분해 알려주면 "이 토큰이 살아 있나"를 묻는 도구가 된다. */
  it('DELETE /auth/session — 언제나 204이고 세션을 실제로 닫는다', async () => {
    const session = JSON.parse(
      (await exchange(String((await login()).searchParams.get('code')))).body,
    ) as SessionResponse

    const withoutHeader = await app.inject({ method: 'DELETE', url: '/api/v1/auth/session' })
    const bogus = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { authorization: 'Bearer nope' },
    })
    const real = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { authorization: `Bearer ${session.sessionToken}` },
    })
    const after = await app.inject({
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session.sessionToken}` },
    })

    expect(withoutHeader.statusCode).toBe(204)
    expect(bogus.statusCode).toBe(204)
    expect(real.statusCode).toBe(204)
    expect(after.statusCode).toBe(401)
  })
})
