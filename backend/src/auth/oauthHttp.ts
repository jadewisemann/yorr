/**
 * 소셜 제공자와의 HTTP 두 번(토큰 교환·프로필 조회)에만 쓰는 최소 클라이언트.
 * backend-java `auth/config/AuthConfig`의 `socialRestClient` 자리다.
 *
 * OAuth 라이브러리를 넣지 않은 이유는 Java 쪽과 같다 — 실제로 필요한 것은
 * 아래 두 번의 호출뿐이고, 라이브러리를 넣으면 인증 경로 전체를 그 모델에
 * 맞춰 다시 배선해야 한다.
 */

/** 주입 가능한 최소 형태. 테스트가 진짜 네트워크 없이 응답을 흉내 낸다. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 호출 하나에 허용하는 전체 시간.
 *
 * Java는 connect 3s + read 5s로 **나눠** 걸지만 Node의 `fetch`에는 그 구분이
 * 없다(AbortSignal 하나가 전체를 덮는다). 그래서 Java의 최악값 8초를 통짜
 * 예산으로 잡는다 — 더 짧게 잡으면 Java에서 되던 느린 로그인이 여기서만
 * 실패하고, 안 걸면 로그인 요청이 영영 매달린다.
 */
const SOCIAL_HTTP_TIMEOUT_MS = 8_000

/** 제공자 호출 실패. 상태 코드까지만 담는다 — 본문에는 클라이언트 키가 섞일 수 있다. */
class SocialHttpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SocialHttpError'
  }
}

export interface SocialHttpOptions {
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
}

/**
 * Java `URLEncoder.encode(value, UTF_8)`와 **같은 결과**를 낸다(application/
 * x-www-form-urlencoded): 공백은 `+`, 안전 문자는 `A-Za-z0-9`와 `.-*_`뿐이다.
 *
 * `encodeURIComponent`만으로는 부족하다 — 공백을 `%20`으로 두고 `!'()~`를
 * 남긴다. authorize URL의 인코딩 모양은 테스트로 고정된 계약이라
 * (`scope=openid+profile+email`) 그대로 맞춘다.
 */
export const formUrlEncode = (value: string | null | undefined): string =>
  encodeURIComponent(value ?? '')
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

/** `application/x-www-form-urlencoded` POST → JSON. 실패는 전부 `SocialHttpError`. */
export const postForm = async (
  url: string,
  form: Record<string, string>,
  options: SocialHttpOptions = {},
): Promise<unknown> =>
  request(url, options, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams(form).toString(),
  })

/** Bearer 토큰으로 프로필을 읽는다. 실패는 전부 `SocialHttpError`. */
export const getJson = async (
  url: string,
  accessToken: string,
  options: SocialHttpOptions = {},
): Promise<unknown> =>
  request(url, options, { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } })

const request = async (
  url: string,
  options: SocialHttpOptions,
  init: RequestInit,
): Promise<unknown> => {
  const call = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await call(url, {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs ?? SOCIAL_HTTP_TIMEOUT_MS),
    })
  } catch (error) {
    // 타임아웃·DNS·TLS 실패가 전부 여기로 온다. 원인은 cause로만 남긴다.
    throw new SocialHttpError('social_request_failed', { cause: error })
  }
  if (!response.ok) {
    // 본문을 읽지도 않는다 — 읽어서 던지면 어딘가에서 응답에 실릴 위험이 생긴다.
    throw new SocialHttpError(`social_response_status_${response.status}`)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new SocialHttpError('social_response_unreadable', { cause: error })
  }
}
