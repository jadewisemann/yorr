import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockApiWorker } from '@/mocks/browser'
import { enableMocking } from '@/mocks/enableMocking'
import { resolveMswMode } from '@/mocks/mswMode'

vi.mock('@/mocks/browser', () => ({ createMockApiWorker: vi.fn() }))
vi.mock('@/mocks/mswMode', () => ({ resolveMswMode: vi.fn() }))

const start = vi.fn(async () => undefined)
const createWorker = vi.mocked(createMockApiWorker)
const mode = vi.mocked(resolveMswMode)

beforeEach(() => {
  vi.clearAllMocks()
  createWorker.mockReturnValue({ start } as unknown as ReturnType<typeof createMockApiWorker>)
})

describe('enableMocking', () => {
  it('off 모드에서는 worker 모듈을 아예 불러오지 않는다', async () => {
    mode.mockReturnValue('off')

    await enableMocking()

    expect(createWorker).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('mock 모드는 handler 없는 요청을 오류로 드러낸다', async () => {
    mode.mockReturnValue('mock')

    await enableMocking()

    expect(createWorker).toHaveBeenCalledWith('mock')
    expect(start).toHaveBeenCalledWith({
      onUnhandledRequest: 'error',
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
  })

  it('fallback 모드는 handler 없는 요청을 실서버로 흘려보낸다', async () => {
    mode.mockReturnValue('fallback')

    await enableMocking()

    expect(createWorker).toHaveBeenCalledWith('fallback')
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ onUnhandledRequest: 'bypass' }))
  })
})
