import type { Env } from '../config/env.js'

/**
 * 소셜 로그인 설정.
 *
 * 값이 없어도 서버는 뜬다(로그인을 건드리지 않는 팀원의 로컬 부팅을 막지 않는다).
 * 대신 로그인 엔드포인트를 **실제로 호출하는 시점**에 `not_configured`로 거절한다.
 */
export interface ProviderConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
}

export interface AuthOptions {
  /**
   * 로그인을 끝낸 사용자를 되돌려 보낼 프론트 주소. **제공자 콘솔에 등록하는
   * 값이 아니다** — 제공자는 백엔드 콜백까지만 돌려보내고, 거기서 프론트로
   * 보내는 것은 우리 서버다.
   */
  readonly frontendRedirectUri: string
  readonly kakao: ProviderConfig
  readonly google: ProviderConfig
}

export const authOptions = (env: Env): AuthOptions => ({
  frontendRedirectUri: env.AUTH_FRONTEND_REDIRECT_URI,
  kakao: {
    clientId: env.KAKAO_CLIENT_ID,
    clientSecret: env.KAKAO_CLIENT_SECRET,
    redirectUri: env.KAKAO_REDIRECT_URI,
  },
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  },
})

const notBlank = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

/** 카카오는 secret이 **선택**이다(콘솔에서 "사용 안 함"으로 둘 수 있다). */
export const kakaoConfigured = (config: ProviderConfig): boolean =>
  notBlank(config.clientId) && notBlank(config.redirectUri)

/** 구글은 secret이 필수다(웹 클라이언트 토큰 교환에 항상 필요). */
export const googleConfigured = (config: ProviderConfig): boolean =>
  notBlank(config.clientId) && notBlank(config.clientSecret) && notBlank(config.redirectUri)
