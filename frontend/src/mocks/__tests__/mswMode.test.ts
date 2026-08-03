import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMswMode } from './mswMode'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveMswMode', () => {
  it('지정이 없으면 모든 API를 mock으로 응답한다', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_ENABLE_MSW', undefined)

    expect(resolveMswMode()).toBe('mock')
  })

  it("'fallback'이면 실서버 우선 모드로 둔다", () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_ENABLE_MSW', 'fallback')

    expect(resolveMswMode()).toBe('fallback')
  })

  it("'false'면 MSW를 끄고 전부 실서버로 보낸다", () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_ENABLE_MSW', 'false')

    expect(resolveMswMode()).toBe('off')
  })

  it('알 수 없는 값은 mock으로 떨어뜨린다', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_ENABLE_MSW', 'yes-please')

    expect(resolveMswMode()).toBe('mock')
  })

  it('프로덕션 빌드에서는 값과 무관하게 끈다 — mock이 실서비스에 섞이면 안 된다', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_ENABLE_MSW', 'fallback')

    expect(resolveMswMode()).toBe('off')
  })
})
