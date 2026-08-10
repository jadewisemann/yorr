import type { AuthSession } from '@/auth/authSession'
import { API_BASE_URL, ApiError, apiRequest } from '@/shared/api/client'

interface SessionResponse {
  userId: string
  nickname: string
  type: string
  sessionToken: string
}

export function kakaoLoginUrl(options?: { forceLogin?: boolean }) {
  const base = `${API_BASE_URL}/auth/kakao/authorize`
  return options?.forceLogin ? `${base}?prompt=login` : base
}

export function googleLoginUrl(options?: { selectAccount?: boolean }) {
  const base = `${API_BASE_URL}/auth/google/authorize`
  return options?.selectAccount ? `${base}?prompt=select_account` : base
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
