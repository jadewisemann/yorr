import { vi } from 'vitest'

/**
 * 미디어 질의 대역. jsdom에는 `matchMedia`가 없고, 화면 검사가 보는 것은 실제
 * 레이아웃이 아니라 "이 질의가 참일 때 무엇을 그리느냐"다. 변화 통지는 쓰지
 * 않으므로 리스너는 받기만 하고 부르지 않는다 — 통지까지 봐야 하는 검사는
 * `styles/__tests__/theme.test.ts`처럼 자기 대역을 따로 세운다.
 *
 * @param answer 참으로 답할 질의를 정한다. 불리언이면 모든 질의에 그렇게 답한다.
 */
export function installMatchMedia(answer: boolean | ((query: string) => boolean)) {
  const matchesQuery = typeof answer === 'boolean' ? () => answer : answer
  window.matchMedia = ((query: string) => ({
    matches: matchesQuery(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
}
