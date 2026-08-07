export type MswMode = 'mock' | 'fallback' | 'off'

/**
 * VITE_ENABLE_MSW 로 MSW 동작을 명시적으로 제어한다.
 * - 'true'(기본): 모든 API 를 mock 으로 응답
 * - 'fallback': 실서버에 먼저 요청하고, 서버에 없는 API 만 mock 으로 응답
 * - 'false': MSW 끔 — 전부 실서버
 */
export function resolveMswMode(): MswMode {
  if (!import.meta.env.DEV) return 'off'
  switch (import.meta.env.VITE_ENABLE_MSW) {
    case 'false':
      return 'off'
    case 'fallback':
      return 'fallback'
    default:
      return 'mock'
  }
}
