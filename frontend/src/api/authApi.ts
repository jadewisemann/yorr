import type { AuthSession } from '@/authSession'
import { API_BASE_URL, ApiError, apiRequest } from './client'

interface SessionResponse {
  userId: string
  nickname: string
  type: string
  sessionToken: string
}

/**
 * 카카오 로그인 시작 주소.
 *
 * fetch가 아니라 <b>전체 페이지 이동</b>으로 열어야 한다 — 서버가 카카오로 302를 보내고,
 * 사용자는 카카오 화면에서 직접 동의해야 한다. XHR로 부르면 리다이렉트가 fetch 안에서
 * 소비돼 화면이 그대로 멈춘다.
 */
export function kakaoLoginUrl(options?: { forceLogin?: boolean }) {
  const base = `${API_BASE_URL}/auth/kakao/authorize`
  // 카카오는 브라우저에 자기 로그인 세션을 갖고 있어, 우리 쪽에서 로그아웃해도 다음 로그인이
  // 동의 화면 없이 즉시 통과한다. 계정을 바꾸려는 사용자만 재인증을 요청한다.
  return options?.forceLogin ? `${base}?prompt=login` : base
}

/** 구글 OAuth 로그인 시작 주소. */
export function googleLoginUrl(options?: { selectAccount?: boolean }) {
  const base = `${API_BASE_URL}/auth/google/authorize`
  return options?.selectAccount ? `${base}?prompt=select_account` : base
}

/**
 * 콜백이 넘긴 일회용 코드를 세션으로 바꾼다. 코드는 60초·1회용이라 실패하면 다시 로그인해야 한다.
 */
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

/**
 * 저장된 세션이 서버에서도 아직 살아 있는지 확인한다.
 *
 * @returns 살아 있으면 서버가 아는 최신 닉네임, 아니면 null
 */
export async function verifySession(sessionToken: string): Promise<string | null> {
  try {
    const response = await apiRequest<SessionResponse>('/auth/me', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    return response.nickname
  } catch (error) {
    // 401만 "세션이 죽었다"는 뜻이다. 서버가 잠깐 안 뜬 것까지 로그아웃으로 취급하면
    // 네트워크가 흔들릴 때마다 사용자가 튕긴다.
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

/** 서버 세션을 닫는다. 실패해도 클라이언트는 로컬을 지운다 — 로그아웃이 서버 사정에 묶이면 안 된다. */
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

/**
 * 닉네임을 바꾼다. 지난 판의 기록에 남은 이름은 바뀌지 않는다 — 그때 화면에 보였던 이름이
 * 그대로 남아야 하기 때문이다.
 */
export async function renameProfile(sessionToken: string, nickname: string): Promise<Profile> {
  return apiRequest<Profile>('/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ nickname }),
  })
}

/** 콜백이 실패를 알릴 때 붙여 보내는 사유. 서버의 SocialLoginException.Reason과 짝이다. */
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
