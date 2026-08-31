/**
 * 소셜 로그인 실패.
 *
 * 사유를 하나로 뭉개지 않는 것이 계약이다. 콜백은 이 값을 소문자 그대로
 * `?error=`에 실어 프론트로 보내고, 프론트(`auth/api/authApi.ts`의
 * `loginErrorMessages`)가 **이 네 문자열만** 화면 문구로 매핑한다.
 */
export type SocialLoginReason = 'not_configured' | 'invalid_state' | 'canceled' | 'provider_error'

export class SocialLoginError extends Error {
  readonly reason: SocialLoginReason

  /**
   * @param detail 로그에만 남는 내부 사유(`kakao_token_exchange_failed` 등).
   * **클라이언트로 나가지 않는다** — 제공자 응답 본문에 클라이언트 키가 섞여
   * 나올 수 있어서 일반화한 `reason`만 내보낸다.
   */
  constructor(reason: SocialLoginReason, detail: string = reason, options?: { cause?: unknown }) {
    super(detail, options)
    this.name = 'SocialLoginError'
    this.reason = reason
  }
}

/**
 * DB 제약 위반 — Java `DataIntegrityViolationException` 자리.
 *
 * 가입 경합에서 **실패가 아니라 신호**로 쓰인다(`socialLoginService.ts` 참고).
 * 유니크 위반만이 아니라 길이·NOT NULL·FK 위반도 같은 갈래인 것이 Java와
 * 같다 — 재조회로 풀리지 않으면 원래 오류를 그대로 다시 던진다.
 */
export class DataIntegrityViolationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DataIntegrityViolationError'
  }
}

/** MySQL이 제약 위반으로 돌려주는 errno. mysql2는 `errno`에 그대로 담아 준다. */
const INTEGRITY_ERRNOS = new Set([
  1048, // ER_BAD_NULL_ERROR
  1062, // ER_DUP_ENTRY — (provider, provider_user_id) 유니크. 가입 경합의 신호다.
  1264, // ER_WARN_DATA_OUT_OF_RANGE
  1406, // ER_DATA_TOO_LONG — 닉네임 20자 초과 등
  1451, // ER_ROW_IS_REFERENCED_2
  1452, // ER_NO_REFERENCED_ROW_2
  3819, // ER_CHECK_CONSTRAINT_VIOLATED
])

export const isMysqlIntegrityViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'errno' in error &&
  typeof (error as { errno: unknown }).errno === 'number' &&
  INTEGRITY_ERRNOS.has((error as { errno: number }).errno)
