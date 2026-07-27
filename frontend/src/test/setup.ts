import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { mockApiServer } from '@/mocks/server'

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: vi.fn(),
})

// jsdom에는 matchMedia가 없다. 기본은 "일치하지 않음"이라 반응형 분기는 좁은 레이아웃으로 떨어진다.
// 넓은 레이아웃을 검증하려면 테스트에서 이 값을 덮어쓴다.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList,
})

beforeAll(() => mockApiServer.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  mockApiServer.resetHandlers()
})
afterAll(() => mockApiServer.close())
