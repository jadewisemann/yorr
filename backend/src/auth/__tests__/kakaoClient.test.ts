import { describe, expect, it } from 'vitest'
import type { ProviderConfig } from '../config.js'
import { SocialLoginError } from '../errors.js'
import { KakaoOAuthClient } from '../kakaoClient.js'
import type { FetchLike } from '../oauthHttp.js'

/**
 * backend-java `auth/infrastructure/KakaoOAuthClientTest` 이식 + Node 고유
 * 관심사(타임아웃·오류 일반화)를 더한 것.
 */

const REDIRECT_URI = 'http://localhost:8080/api/v1/auth/kakao/callback'

const config = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  clientId: 'rest-api-key',
  clientSecret: 'secret',
  redirectUri: REDIRECT_URI,
  ...overrides,
})

interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

const stubFetch = (responses: Response[]): { fetch: FetchLike; calls: Call[] } => {
  const calls: Call[] = []
  const queue = [...responses]
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      const next = queue.shift()
      if (next === undefined) throw new Error(`예상하지 않은 호출: ${url}`)
      return next
    },
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const reason = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof SocialLoginError) return error.reason
    throw error
  }
  throw new Error('SocialLoginError가 던져지지 않았다')
}

describe('KakaoOAuthClient', () => {
  /**
   * redirect_uri는 카카오 콘솔 등록값과 문자 하나까지 같아야 하고(KOE006), 쿼리
   * 파라미터로 실리므로 인코딩되어야 한다. 둘 중 하나만 어긋나도 동의 화면에
   * 도달조차 못 한다.
   */
  it('동의 화면 주소에 필수 파라미터를 담고 redirect_uri를 인코딩한다', () => {
    const url = new KakaoOAuthClient(config()).authorizeUrl('state-1', false)

    expect(url.startsWith('https://kauth.kakao.com/oauth/authorize?')).toBe(true)
    expect(url).toContain('response_type=code')
    expect(url).toContain('client_id=rest-api-key')
    expect(url).toContain('state=state-1')
    expect(url).toContain(
      'redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fapi%2Fv1%2Fauth%2Fkakao%2Fcallback',
    )
    // 인코딩되지 않은 원본이 그대로 남아 있으면 카카오가 파라미터를 잘라 읽는다.
    expect(url).not.toContain(`redirect_uri=${REDIRECT_URI}`)
  })

  it('계정을 다시 고르게 하려면 prompt=login을 붙인다', () => {
    const client = new KakaoOAuthClient(config())

    expect(client.authorizeUrl('state-1', true)).toContain('prompt=login')
    // 기본은 빠른 재로그인이다 — 매번 비밀번호를 다시 받으면 로그인해 둔 의미가 없다.
    expect(client.authorizeUrl('state-1', false)).not.toContain('prompt')
  })

  /** 환경변수가 없는 팀원의 로컬에서도 서버는 떠야 한다 — 대신 호출 시점에 사유가 분명해야 한다. */
  it('설정이 비어 있으면 not_configured로 거절한다', async () => {
    expect(() => new KakaoOAuthClient(config({ clientId: '' })).authorizeUrl('s', false)).toThrow(
      SocialLoginError,
    )
    expect(
      await reason(() => new KakaoOAuthClient(config({ redirectUri: '' })).fetchProfile('code')),
    ).toBe('not_configured')
    // secret은 선택이다 — 콘솔에서 "사용 안 함"인 앱도 로그인할 수 있어야 한다.
    expect(() =>
      new KakaoOAuthClient(config({ clientSecret: '' })).authorizeUrl('s', false),
    ).not.toThrow()
  })

  it('인가 코드를 토큰으로 바꾼 뒤 프로필을 읽는다', async () => {
    const { fetch, calls } = stubFetch([
      json({ access_token: 'access-1' }),
      json({
        id: 1234567890,
        kakao_account: { profile: { nickname: '카카오닉', profile_image_url: 'https://img' } },
      }),
    ])

    const profile = await new KakaoOAuthClient(config(), { fetch }).fetchProfile('auth-code')

    expect(profile).toEqual({
      providerUserId: '1234567890',
      nickname: '카카오닉',
      profileImageUrl: 'https://img',
    })
    expect(calls[0]?.url).toBe('https://kauth.kakao.com/oauth/token')
    const form = new URLSearchParams(String(calls[0]?.init?.body))
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(form.get('code')).toBe('auth-code')
    expect(form.get('client_secret')).toBe('secret')
    // 토큰은 프로필 조회에만 쓰고 저장하지 않는다.
    expect(calls[1]?.url).toBe('https://kapi.kakao.com/v2/user/me')
    const profileHeaders = calls[1]?.init?.headers as Record<string, string> | undefined
    expect(profileHeaders?.authorization).toBe('Bearer access-1')
  })

  /** secret을 "사용 안 함"으로 둔 앱에 secret을 보내면 카카오가 거절한다. */
  it('client_secret이 비어 있으면 폼에 담지 않는다', async () => {
    const { fetch, calls } = stubFetch([
      json({ access_token: 'access-1' }),
      json({ id: 7, kakao_account: { profile: { nickname: '닉' } } }),
    ])

    await new KakaoOAuthClient(config({ clientSecret: '' }), { fetch }).fetchProfile('c')

    expect(new URLSearchParams(String(calls[0]?.init?.body)).has('client_secret')).toBe(false)
  })

  /**
   * 앱 설정에 따라 프로필이 구형 `properties`로만 오는 경우가 있다. 동의항목을
   * 껐다면 어느 쪽도 없고, 그래도 로그인 자체는 되어야 한다.
   */
  it('닉네임은 kakao_account → properties → 플레이스홀더 순으로 고른다', async () => {
    const legacy = stubFetch([
      json({ access_token: 'a' }),
      json({ id: 1, properties: { nickname: '구형닉', profile_image: 'https://legacy' } }),
    ])
    const none = stubFetch([json({ access_token: 'a' }), json({ id: 2 })])

    const fromLegacy = await new KakaoOAuthClient(config(), legacy).fetchProfile('c')
    const fallback = await new KakaoOAuthClient(config(), none).fetchProfile('c')

    expect(fromLegacy.nickname).toBe('구형닉')
    expect(fromLegacy.profileImageUrl).toBe('https://legacy')
    expect(fallback.nickname).toBe('플레이어')
    expect(fallback.profileImageUrl).toBeNull()
  })

  /** users.nickname은 20자다 — 더 길면 저장이 아니라 절단이다. */
  it('20자를 넘는 닉네임은 잘라서 쓴다', async () => {
    const { fetch } = stubFetch([
      json({ access_token: 'a' }),
      json({ id: 1, kakao_account: { profile: { nickname: '가'.repeat(25) } } }),
    ])

    const profile = await new KakaoOAuthClient(config(), { fetch }).fetchProfile('c')

    expect(profile.nickname).toBe('가'.repeat(20))
  })

  it('id가 없으면 provider_error다', async () => {
    const { fetch } = stubFetch([json({ access_token: 'a' }), json({ properties: {} })])

    expect(await reason(() => new KakaoOAuthClient(config(), { fetch }).fetchProfile('c'))).toBe(
      'provider_error',
    )
  })

  it('토큰 응답에 access_token이 없으면 provider_error다', async () => {
    const { fetch } = stubFetch([json({ error: 'invalid_grant' })])

    expect(await reason(() => new KakaoOAuthClient(config(), { fetch }).fetchProfile('c'))).toBe(
      'provider_error',
    )
  })

  /**
   * 제공자 응답 본문에는 우리 클라이언트 키가 섞여 나올 수 있다. 사유는
   * provider_error로 뭉개고 본문은 어디에도 담지 않는다.
   */
  it('제공자 오류 본문을 밖으로 흘리지 않는다', async () => {
    const { fetch } = stubFetch([
      json({ error: 'invalid_client', error_description: 'client_secret=super-secret' }, 401),
    ])

    let caught: unknown
    try {
      await new KakaoOAuthClient(config(), { fetch }).fetchProfile('c')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(SocialLoginError)
    expect((caught as SocialLoginError).reason).toBe('provider_error')
    expect((caught as SocialLoginError).message).toBe('kakao_token_exchange_failed')
    const chain = `${(caught as Error).message} ${String((caught as Error).cause)}`
    expect(chain).not.toContain('super-secret')
  })

  /**
   * 타임아웃을 걸지 않으면 카카오가 느려질 때 로그인 요청이 그대로 매달린다.
   * Node의 fetch에는 connect/read 구분이 없어 AbortSignal 하나로 전체를 덮는다.
   */
  it('응답이 없으면 타임아웃으로 끊고 provider_error로 돌린다', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, rejectPromise) => {
        init?.signal?.addEventListener('abort', () => rejectPromise(init.signal?.reason))
      })

    const client = new KakaoOAuthClient(config(), { fetch: hanging, timeoutMs: 10 })

    expect(await reason(() => client.fetchProfile('c'))).toBe('provider_error')
  })
})
