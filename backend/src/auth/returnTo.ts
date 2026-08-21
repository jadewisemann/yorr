import type { AuthOptions } from './config.js'

/**
 * 로그인을 끝낸 사용자를 **시작한 출처로** 되돌려 보낸다.
 *
 * 왜 필요한가: 복귀 주소가 설정값 하나(`AUTH_FRONTEND_REDIRECT_URI`)뿐이면
 * 프론트가 여러 출처에서 돌 때(운영 도메인 + Vercel 기본 주소 + 로컬) 어디서
 * 로그인해도 그 하나로 튕긴다. 세션 토큰은 출처별 `localStorage`에 저장되므로
 * **다른 출처로 튕기는 것은 곧 로그인 실패**다(화면은 로그아웃 상태로 보인다).
 *
 * 고를 수 있는 것은 **출처뿐이고 경로가 아니다** — 경로·쿼리는 설정값에서 그대로
 * 가져오고 스킴·호스트만 바꿔 끼운다. 그래서 이 함수는 오픈 리다이렉트가 될 수
 * 없다: 목록에 없는 출처는 조용히 설정값으로 되돌린다(거절이 아니다 — 로그인
 * 버튼이 500을 보는 것보다 정본 도메인으로 돌아가는 편이 낫다).
 *
 * 목록은 CORS 허용 출처를 그대로 쓴다(`AuthOptions.returnOrigins`). 이미 "우리가
 * 서비스하는 프론트 목록"이고, 둘을 따로 두면 한쪽만 갱신되는 순간 증상이
 * "CORS는 되는데 로그인만 안 된다"가 된다. 단 **`*`는 여기서 받지 않는다** —
 * WS 게이트웨이의 와일드카드는 "누가 우리를 부를 수 있는가"이지만, 여기서
 * 와일드카드는 "누구에게든 코드를 실어 보낸다"가 되어 의미가 다르다.
 */
export const resolveReturnUrl = (
  options: AuthOptions,
  requestedOrigin: string | undefined,
): string => {
  const configured = options.frontendRedirectUri
  const requested = normalizeOrigin(requestedOrigin)
  if (requested === null) return configured
  if (!options.returnOrigins.includes(requested)) return configured
  return swapOrigin(configured, requested) ?? configured
}

/** 끝의 `/`를 떼는 것은 `allowedOrigins()`와 같은 이유다 — 목록은 경로 없는 출처다. */
const normalizeOrigin = (value: string | undefined): string | null => {
  const trimmed = value?.trim().replace(/\/+$/, '')
  if (trimmed === undefined || trimmed.length === 0 || trimmed === '*') return null
  return trimmed
}

/** 설정값의 경로·쿼리는 유지하고 스킴·호스트만 갈아 끼운다. 파싱 실패는 `null`. */
const swapOrigin = (configured: string, origin: string): string | null => {
  try {
    const target = new URL(configured)
    return new URL(`${target.pathname}${target.search}${target.hash}`, origin).toString()
  } catch {
    return null
  }
}
