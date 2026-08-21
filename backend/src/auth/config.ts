import { allowedOrigins, type Env } from '../config/env.js'

/**
 * 소셜 로그인 설정 — backend-java `auth/config/AuthProperties`.
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
  /**
   * `frontendRedirectUri` 대신 쓸 수 있는 프론트 출처 목록 — 프론트가 여러 주소에서
   * 돌 때 **로그인을 시작한 출처로** 되돌려 보내기 위한 것이다(`auth/returnTo.ts`).
   * CORS 허용 출처를 그대로 쓴다: 목록을 둘로 나누면 한쪽만 갱신되는 순간 증상이
   * "CORS는 되는데 로그인만 안 된다"가 된다.
   */
  readonly returnOrigins: readonly string[]
  readonly kakao: ProviderConfig
  readonly google: ProviderConfig
}

export const authOptions = (env: Env): AuthOptions => ({
  frontendRedirectUri: env.AUTH_FRONTEND_REDIRECT_URI,
  returnOrigins: allowedOrigins(env),
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
