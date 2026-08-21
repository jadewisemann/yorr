import { describe, expect, it } from 'vitest'
import type { AuthOptions } from '../config.js'
import { resolveReturnUrl } from '../returnTo.js'

/**
 * 복귀 주소 결정 — 프론트가 여러 출처에서 돌 때 **로그인을 시작한 곳으로** 돌아가기
 * 위한 규칙이다. 고정하는 것은 두 가지다: 목록에 있는 출처만 통과한다는 것(오픈
 * 리다이렉트 방지)과, 고를 수 있는 것이 출처뿐이고 **경로는 설정값에서 온다**는 것.
 */

const options = (frontendRedirectUri: string, returnOrigins: readonly string[]): AuthOptions => ({
  frontendRedirectUri,
  returnOrigins,
  kakao: { clientId: '', clientSecret: '', redirectUri: '' },
  google: { clientId: '', clientSecret: '', redirectUri: '' },
})

const PROD = options('https://yorr.site/auth/callback', [
  'https://yorr.site',
  'https://yorr-eight.vercel.app',
])

describe('resolveReturnUrl', () => {
  it('목록에 있는 출처면 경로는 그대로 두고 그 출처로 되돌린다', () => {
    expect(resolveReturnUrl(PROD, 'https://yorr-eight.vercel.app')).toBe(
      'https://yorr-eight.vercel.app/auth/callback',
    )
  })

  it('출처를 안 보내면 설정값 그대로다 — 기존 동작이 기본이다', () => {
    expect(resolveReturnUrl(PROD, undefined)).toBe('https://yorr.site/auth/callback')
    expect(resolveReturnUrl(PROD, '')).toBe('https://yorr.site/auth/callback')
  })

  it('목록에 없는 출처는 거절이 아니라 설정값으로 조용히 되돌린다', () => {
    expect(resolveReturnUrl(PROD, 'https://evil.example')).toBe('https://yorr.site/auth/callback')
  })

  /** CORS 목록에는 와일드카드가 있을 수 있지만 여기서는 "누구에게든"이 되므로 안 받는다. */
  it('`*`는 통과시키지 않는다', () => {
    expect(resolveReturnUrl(options('https://yorr.site/auth/callback', ['*']), '*')).toBe(
      'https://yorr.site/auth/callback',
    )
    expect(
      resolveReturnUrl(options('https://yorr.site/auth/callback', ['*']), 'https://evil.example'),
    ).toBe('https://yorr.site/auth/callback')
  })

  it('끝의 `/`는 목록 비교 전에 떼어 낸다(목록은 경로 없는 출처다)', () => {
    expect(resolveReturnUrl(PROD, 'https://yorr-eight.vercel.app/')).toBe(
      'https://yorr-eight.vercel.app/auth/callback',
    )
  })

  /** 클라이언트가 고르는 것은 출처뿐이다 — 경로를 실어 보내도 목록 비교에서 걸러진다. */
  it('경로가 붙은 값은 출처로 인정하지 않는다', () => {
    expect(resolveReturnUrl(PROD, 'https://yorr-eight.vercel.app/somewhere')).toBe(
      'https://yorr.site/auth/callback',
    )
  })

  it('설정값의 쿼리는 유지한다', () => {
    const withQuery = options('https://yorr.site/auth/callback?from=login', [
      'https://yorr-eight.vercel.app',
    ])

    expect(resolveReturnUrl(withQuery, 'https://yorr-eight.vercel.app')).toBe(
      'https://yorr-eight.vercel.app/auth/callback?from=login',
    )
  })

  it('설정값이 절대 URL이 아니면 손대지 않는다', () => {
    const relative = options('/auth/callback', ['https://yorr-eight.vercel.app'])

    expect(resolveReturnUrl(relative, 'https://yorr-eight.vercel.app')).toBe('/auth/callback')
  })
})
