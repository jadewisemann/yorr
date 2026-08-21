import type { AuthSession } from '@/auth/authSession'
import { API_BASE_URL, ApiError, apiRequest } from '@/shared/api/client'

interface SessionResponse {
  userId: string
  nickname: string
  type: string
  sessionToken: string
}

/**
 * 로그인을 시작하는 주소. `origin`을 실어 보내는 이유: 서버의 복귀 주소는 설정값
 * 하나여서, 그것을 알려주지 않으면 **어느 주소에서 로그인해도 그 하나로 튕긴다**
 * (세션은 출처별 `localStorage`에 저장되므로 다른 출처로 튕기면 로그아웃 상태로
 * 보인다). 운영 도메인·Vercel 기본 주소·로컬이 같은 백엔드를 볼 때 필요하다.
 * 서버는 허용 목록에 있는 출처만 받고 나머지는 조용히 설정값으로 되돌린다.
 */
function authorizeUrl(provider: 'kakao' | 'google', prompt?: string) {
  const params = new URLSearchParams()
  if (prompt !== undefined) params.set('prompt', prompt)
  const origin = globalThis.location?.origin
  if (origin) params.set('origin', origin)
  const query = params.toString()
  return `${API_BASE_URL}/auth/${provider}/authorize${query === '' ? '' : `?${query}`}`
}

export function kakaoLoginUrl(options?: { forceLogin?: boolean }) {
  return authorizeUrl('kakao', options?.forceLogin ? 'login' : undefined)
}

export function googleLoginUrl(options?: { selectAccount?: boolean }) {
  return authorizeUrl('google', options?.selectAccount ? 'select_account' : undefined)
}

export async function exchangeLoginCode(code: string): Promise<AuthSession> {
  const response = await apiRequest<SessionResponse>('/auth/session', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
  return {
    userId: response.userId,
    nickname: response.nickname,
    sessionToken: response.sessionToken,
  }
}

export async function verifySession(sessionToken: string): Promise<string | null> {
  try {
    const response = await apiRequest<SessionResponse>('/auth/me', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    return response.nickname
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export async function closeSession(sessionToken: string) {
  await apiRequest<void>('/auth/session', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
}

export interface Profile {
  userId: string
  nickname: string
  profileImageUrl: string | null
}

export async function renameProfile(sessionToken: string, nickname: string): Promise<Profile> {
  return apiRequest<Profile>('/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ nickname }),
  })
}

export const loginErrorMessages: Record<string, string> = {
  canceled: '로그인을 취소했어요.',
  invalid_state: '로그인 요청이 만료됐어요. 다시 시도해 주세요.',
  not_configured: '지금은 로그인을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
  provider_error: '로그인 제공자와 연결하지 못했어요. 다시 시도해 주세요.',
}

export function loginErrorMessage(reason: string | undefined) {
  if (!reason) return '로그인에 실패했어요. 다시 시도해 주세요.'
  return loginErrorMessages[reason] ?? '로그인에 실패했어요. 다시 시도해 주세요.'
}
