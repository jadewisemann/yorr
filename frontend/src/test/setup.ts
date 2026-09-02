import { installMatchMedia } from './mediaQuery'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { createElement, type ElementType, type ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { mockApiServer } from '@/mocks/server'

configure({ asyncUtilTimeout: 5000 })

MotionGlobalConfig.instantAnimations = true
MotionGlobalConfig.skipAnimations = true

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>()
  const wrapped = new Map<string, ElementType>()
  const motion = new Proxy(actual.motion, {
    get(target, key) {
      if (typeof key !== 'string' || key === 'create') return Reflect.get(target, key)
      const cached = wrapped.get(key)
      if (cached) return cached
      const Component = Reflect.get(target, key) as ElementType
      const Wrapped = (props: Record<string, unknown>) =>
        createElement(Component, { ...props, initial: false })
      wrapped.set(key, Wrapped)
      return Wrapped
    },
  })
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion,
  }
})
Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  writable: true,
  value: () => {
    const animation = {
      cancel: vi.fn(),
      commitStyles: vi.fn(),
      currentTime: 0,
      finish: vi.fn(),
      finished: Promise.resolve(),
      pause: vi.fn(),
      play: vi.fn(),
      playState: 'finished',
      addEventListener: (_: string, handler: () => void) => queueMicrotask(handler),
      removeEventListener: vi.fn(),
      onfinish: null as (() => void) | null,
    }
    queueMicrotask(() => animation.onfinish?.())
    return animation
  },
})

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: vi.fn(),
})

// 어떤 질의에도 아니라고 답한다. 넓은 화면 갈래를 보는 검사가 각자 덮어쓴다.
installMatchMedia(false)

Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: vi.fn(() => Promise.resolve()),
})
Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: vi.fn(),
})

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
