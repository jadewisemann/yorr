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

// vitest jsdom 환경에는 localStorage가 없다(Node 실험 전역과 충돌). 방 세션 영속화가
// localStorage를 쓰므로 전 테스트 공통 인메모리 스텁을 둔다. 격리는 harness의 clear()가 맡는다.
const localStorageData = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageData.get(key) ?? null,
    setItem: (key: string, value: string) => void localStorageData.set(key, value),
    removeItem: (key: string) => void localStorageData.delete(key),
    clear: () => localStorageData.clear(),
  },
})

beforeAll(() => mockApiServer.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  mockApiServer.resetHandlers()
})
afterAll(() => mockApiServer.close())
