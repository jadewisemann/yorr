import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { mockApiServer } from '@/mocks/server'

// jsdom에는 WAAPI(Element.animate)가 없어 motion이 애니메이션을 시작하지 못한다.
// 진입은 initial(opacity 0)에 멈추고, 더 나쁜 건 AnimatePresence의 퇴장이 끝나지 않아
// 닫은 다이얼로그가 DOM에 남는 것이다 — "닫혔는가"를 검증할 수 없게 된다.
// 즉시 끝난 것으로 처리해 테스트가 항상 최종 상태를 보게 한다.
MotionGlobalConfig.instantAnimations = true
MotionGlobalConfig.skipAnimations = true

// AnimatePresence는 퇴장 애니메이션이 끝날 때까지 자식을 붙잡아 둔다. jsdom에서는 그
// 애니메이션이 시작조차 못 하므로 닫은 다이얼로그가 영영 DOM에 남는다 — "닫혔는가"를
// 검증할 수 없다. 테스트에서는 통과 컴포넌트로 바꿔 마운트·언마운트를 motion 도입 전과
// 같게 만든다. 진입·퇴장 연출 자체는 실기기·Playwright 시각 검토의 몫이다.
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>()
  return { ...actual, AnimatePresence: ({ children }: { children: ReactNode }) => children }
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

// jsdom은 HTMLMediaElement.play/pause를 구현하지 않고 "Not implemented" 오류만 남긴다.
// 족보 목소리(handVoice)가 이 둘을 호출하므로 조용한 스텁으로 바꿔 테스트 출력을 지킨다.
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
