/** DB에 이름 문자열로 저장한다(`social_accounts.provider` — V1 스키마). */
export type SocialProvider = 'KAKAO' | 'GOOGLE'

/**
 * 제공자가 닉네임을 주지 않았을 때 쓰는 임시 이름(동의항목이 꺼져 있거나 거절한
 * 경우) — backend-java `user/domain/User.PLACEHOLDER_NICKNAME`.
 *
 * "이 이름은 사용자가 고른 것이 아니다"라는 표시이기도 하다. 나중에 진짜 이름을
 * 받았을 때 덮어써도 되는지 판단하는 근거가 된다(`socialLoginService.ts`).
 */
export const PLACEHOLDER_NICKNAME = '플레이어'

/** `users.nickname` 컬럼 길이. 더 길면 잘라서 저장한다(제약 위반이 아니라 절단). */
export const NICKNAME_MAX_LENGTH = 20

/** 제공자에 상관없이 로그인에 필요한 최소 정보. */
export interface SocialProfile {
  readonly providerUserId: string
  readonly nickname: string
  readonly profileImageUrl: string | null
}

/** 회원 한 명(users 행). */
export interface MemberUser {
  readonly id: string
  readonly nickname: string
  readonly profileImageUrl: string | null
}

export const blankToNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

export const firstNotBlank = (...values: unknown[]): string | null => {
  for (const value of values) {
    const candidate = blankToNull(value)
    if (candidate !== null) return candidate
  }
  return null
}

/**
 * 제공자가 준 후보들 중 첫 유효값을 닉네임으로 삼는다. 하나도 없으면
 * 플레이스홀더 — **동의항목을 거절해도 로그인 자체는 되어야 한다.**
 */
export const providerNickname = (...candidates: unknown[]): string => {
  const value = firstNotBlank(...candidates)
  if (value === null) return PLACEHOLDER_NICKNAME
  const trimmed = value.trim()
  return trimmed.length > NICKNAME_MAX_LENGTH ? trimmed.slice(0, NICKNAME_MAX_LENGTH) : trimmed
}
