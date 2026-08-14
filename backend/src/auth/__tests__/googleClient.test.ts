import { describe, expect, it } from 'vitest'
import type { ProviderConfig } from '../config.js'
import { SocialLoginError } from '../errors.js'
import { GoogleOAuthClient } from '../googleClient.js'
import type { FetchLike } from '../oauthHttp.js'

/** backend-java `auth/infrastructure/GoogleOAuthClientTest` 이식 + 오류 일반화. */

const REDIRECT_URI = 'http://localhost:8080/api/v1/auth/google/callback'

const config = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  clientId: 'client-id',
  clientSecret: 'secret',
  redirectUri: REDIRECT_URI,
  ...overrides,
})

const stubFetch = (responses: Response[]): { fetch: FetchLike; bodies: string[] } => {
  const bodies: string[] = []
  const queue = [...responses]
  return {
    bodies,
    fetch: async (url, init) => {
      bodies.push(String(init?.body ?? ''))
      const next = queue.shift()
      if (next === undefined) throw new Error(`예상하지 않은 호출: ${url}`)
      return next
    },
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const reason = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof SocialLoginError) return error.reason
    throw error
  }
  throw new Error('SocialLoginError가 던져지지 않았다')
}

describe('GoogleOAuthClient', () => {
  it('인가 주소에 필수 파라미터를 인코딩해 담는다', () => {
    const url = new GoogleOAuthClient(config()).authorizeUrl('state-1', false)

    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
    expect(url).toContain('response_type=code')
    expect(url).toContain('client_id=client-id')
    expect(url).toContain(
      'redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fapi%2Fv1%2Fauth%2Fgoogle%2Fcallback',
    )
    // 공백은 form-urlencoded 규칙대로 `+`다(%20이 아니다).
    expect(url).toContain('scope=openid+profile+email')
    expect(url).toContain('state=state-1')
    expect(url).not.toContain('prompt=select_account')
  })

  it('계정 선택을 요청하면 prompt를 붙인다', () => {
    expect(new GoogleOAuthClient(config()).authorizeUrl('state-1', true)).toContain(
      'prompt=select_account',
    )
  })

  /** 구글은 카카오와 달리 secret이 **필수**다 — 토큰 교환이 그것 없이는 불가능하다. */
  it('필수 설정이 없으면 로그인을 시작하지 않는다', async () => {
    expect(() => new GoogleOAuthClient(config({ clientId: '' })).authorizeUrl('s', false)).toThrow(
      SocialLoginError,
    )
    expect(() =>
      new GoogleOAuthClient(config({ clientSecret: '' })).authorizeUrl('s', false),
    ).toThrow(SocialLoginError)
    expect(
      await reason(() => new GoogleOAuthClient(config({ redirectUri: '' })).fetchProfile('c')),
    ).toBe('not_configured')
  })

  it('sub를 식별자로, name → email → 플레이스홀더 순으로 닉네임을 정한다', async () => {
    const named = stubFetch([
      json({ access_token: 'a' }),
      json({ sub: '10769150350006150715', name: '구글닉', picture: 'https://img' }),
    ])
    const emailOnly = stubFetch([
      json({ access_token: 'a' }),
      json({ sub: 'sub-2', email: 'player@example.com', picture: '' }),
    ])
    const anonymous = stubFetch([json({ access_token: 'a' }), json({ sub: 'sub-3' })])

    const withName = await new GoogleOAuthClient(config(), named).fetchProfile('c')
    const withEmail = await new GoogleOAuthClient(config(), emailOnly).fetchProfile('c')
    const withNeither = await new GoogleOAuthClient(config(), anonymous).fetchProfile('c')

    expect(withName).toEqual({
      providerUserId: '10769150350006150715',
      nickname: '구글닉',
      profileImageUrl: 'https://img',
    })
    expect(withEmail.nickname).toBe('player@example.com')
    expect(withEmail.profileImageUrl).toBeNull()
    expect(withNeither.nickname).toBe('플레이어')
  })

  it('토큰 교환 폼에 client_secret과 redirect_uri를 담는다', async () => {
    const { fetch, bodies } = stubFetch([
      json({ access_token: 'a' }),
      json({ sub: 's', name: 'n' }),
    ])

    await new GoogleOAuthClient(config(), { fetch }).fetchProfile('auth-code')

    const form = new URLSearchParams(bodies[0])
    expect(form.get('client_secret')).toBe('secret')
    expect(form.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(form.get('code')).toBe('auth-code')
  })

  it('sub가 없으면 provider_error다', async () => {
    const { fetch } = stubFetch([json({ access_token: 'a' }), json({ name: '이름만' })])

    expect(await reason(() => new GoogleOAuthClient(config(), { fetch }).fetchProfile('c'))).toBe(
      'provider_error',
    )
  })

  it('프로필 조회가 실패하면 본문 없이 provider_error로 뭉갠다', async () => {
    const { fetch } = stubFetch([
      json({ access_token: 'a' }),
      json({ error: { message: 'client_id=leaked' } }, 403),
    ])

    let caught: unknown
    try {
      await new GoogleOAuthClient(config(), { fetch }).fetchProfile('c')
    } catch (error) {
      caught = error
    }

    expect((caught as SocialLoginError).reason).toBe('provider_error')
    expect((caught as SocialLoginError).message).toBe('google_user_fetch_failed')
    expect(`${(caught as Error).message} ${String((caught as Error).cause)}`).not.toContain(
      'leaked',
    )
  })
})
