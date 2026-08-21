import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  closeSession,
  exchangeLoginCode,
  googleLoginUrl,
  kakaoLoginUrl,
  loginErrorMessage,
  renameProfile,
  verifySession,
} from '@/auth/api/authApi'
import { mockApiServer } from '@/mocks/server'
import { API_BASE_URL, ApiError } from '@/shared/api/client'

/**
 * 시작 주소에는 **현재 출처**가 실린다 — 서버가 로그인을 끝낸 뒤 여기로 되돌려
 * 보내야 하기 때문이다(설정값 하나로 고정하면 다른 주소에서 로그인한 사용자가
 * 그 하나로 튕기고, 세션은 출처별 localStorage라서 로그아웃으로 보인다).
 */
const ORIGIN = `origin=${encodeURIComponent(globalThis.location.origin)}`

describe('kakaoLoginUrl', () => {
  it('기본은 카카오 인가 주소에 현재 출처만 실어 돌려준다', () => {
    expect(kakaoLoginUrl()).toBe(`${API_BASE_URL}/auth/kakao/authorize?${ORIGIN}`)
  })

  it('forceLogin이면 계정 재선택을 위한 prompt=login을 붙인다', () => {
    expect(kakaoLoginUrl({ forceLogin: true })).toBe(
      `${API_BASE_URL}/auth/kakao/authorize?prompt=login&${ORIGIN}`,
    )
  })
})

describe('googleLoginUrl', () => {
  it('기본은 구글 인가 주소에 현재 출처만 실어 돌려준다', () => {
    expect(googleLoginUrl()).toBe(`${API_BASE_URL}/auth/google/authorize?${ORIGIN}`)
  })

  it('계정 선택 요청이면 prompt=select_account를 붙인다', () => {
    expect(googleLoginUrl({ selectAccount: true })).toBe(
      `${API_BASE_URL}/auth/google/authorize?prompt=select_account&${ORIGIN}`,
    )
  })
})

describe('exchangeLoginCode', () => {
  it('일회용 코드를 세션으로 바꾸고 회원 type 필드는 버린다', async () => {
    const session = await exchangeLoginCode('one-time-code')

    expect(session).toEqual({
      userId: 'mock-member-id',
      nickname: '카카오회원',
      sessionToken: 'mock-member-token',
    })
    expect(session).not.toHaveProperty('type')
  })

  it('코드가 만료되면 401 ApiError로 실패한다', async () => {
    await expect(exchangeLoginCode('')).rejects.toMatchObject({ status: 401 })
  })
})

describe('verifySession', () => {
  it('세션이 살아 있으면 서버가 아는 최신 닉네임을 돌려준다', async () => {
    await expect(verifySession('any-token')).resolves.toBe('카카오회원')
  })

  it('401이면 예외 대신 null로 조용히 로그아웃을 알린다', async () => {
    mockApiServer.use(
      http.get('/api/v1/auth/me', () => HttpResponse.text('session_expired', { status: 401 })),
    )

    await expect(verifySession('expired-token')).resolves.toBeNull()
  })

  it('401이 아닌 오류는 그대로 다시 던진다', async () => {
    mockApiServer.use(http.get('/api/v1/auth/me', () => HttpResponse.text('boom', { status: 500 })))

    await expect(verifySession('any-token')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('closeSession', () => {
  it('저장된 세션 토큰을 실어 로그아웃을 요청한다', async () => {
    let authorization = ''
    mockApiServer.use(
      http.delete('/api/v1/auth/session', ({ request }) => {
        authorization = request.headers.get('Authorization') ?? ''
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(closeSession('token-1')).resolves.toBeUndefined()
    expect(authorization).toBe('Bearer token-1')
  })
})

describe('renameProfile', () => {
  it('인증 헤더와 새 닉네임을 실어 프로필을 갱신한다', async () => {
    let authorization = ''
    let body: unknown
    mockApiServer.use(
      http.patch('/api/v1/users/me', async ({ request }) => {
        authorization = request.headers.get('Authorization') ?? ''
        body = await request.json()
        return HttpResponse.json({
          userId: 'mock-member-id',
          nickname: '새이름',
          profileImageUrl: null,
        })
      }),
    )

    await expect(renameProfile('token-1', '새이름')).resolves.toEqual({
      userId: 'mock-member-id',
      nickname: '새이름',
      profileImageUrl: null,
    })
    expect(authorization).toBe('Bearer token-1')
    expect(body).toEqual({ nickname: '새이름' })
  })
})

describe('loginErrorMessage', () => {
  it('알려진 사유는 안내 문구로 옮긴다', () => {
    expect(loginErrorMessage('canceled')).toBe('로그인을 취소했어요.')
    expect(loginErrorMessage('invalid_state')).toBe('로그인 요청이 만료됐어요. 다시 시도해 주세요.')
    expect(loginErrorMessage('not_configured')).toBe(
      '지금은 로그인을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(loginErrorMessage('provider_error')).toBe(
      '로그인 제공자와 연결하지 못했어요. 다시 시도해 주세요.',
    )
  })

  it('모르는 사유·없는 사유는 기본 문구로 대신한다', () => {
    expect(loginErrorMessage('unknown_reason')).toBe('로그인에 실패했어요. 다시 시도해 주세요.')
    expect(loginErrorMessage(undefined)).toBe('로그인에 실패했어요. 다시 시도해 주세요.')
  })
})
