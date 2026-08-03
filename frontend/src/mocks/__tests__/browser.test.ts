import type { RequestHandler } from 'msw'
import { setupWorker } from 'msw/browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockApiWorker } from '@/mocks/browser'
import { createRestHandlers } from '@/mocks/restHandlers'

vi.mock('msw/browser', () => ({ setupWorker: vi.fn(() => ({ start: vi.fn() })) }))

const worker = vi.mocked(setupWorker)

function registeredHandlers() {
  return (worker.mock.calls.at(-1) ?? []) as RequestHandler[]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createMockApiWorker', () => {
  it('mock 모드는 REST mock handler만 등록한다', () => {
    createMockApiWorker('mock')

    expect(registeredHandlers()).toHaveLength(createRestHandlers().length)
  })

  it('fallback 모드는 실서버 우선 catch-all을 mock handler보다 앞에 둔다', () => {
    // 순서가 뒤집히면 mock이 먼저 응답해 fallback 모드가 무의미해진다.
    createMockApiWorker('fallback')
    const handlers = registeredHandlers()

    expect(handlers).toHaveLength(createRestHandlers().length + 1)
    expect(handlers[0]?.info).toMatchObject({ header: '/.+/ /api/*', path: '/api/*' })
  })
})
