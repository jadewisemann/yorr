import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeSync } from '@/app/model/useThemeSync'
import { useAppStore } from '@/store'

/**
 * 첫 적용은 `index.html`의 프리페인트 스크립트가 한다. 이 훅이 맡는 것은 그 뒤의
 * 변화뿐이고, **`system`을 고른 동안에만** OS 설정을 따라간다.
 */
describe('useThemeSync', () => {
  const listeners: ((event: MediaQueryListEvent) => void)[] = []

  beforeEach(() => {
    listeners.length = 0
    useAppStore.getState().reset()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        void listeners.push(listener),
      removeEventListener: vi.fn(),
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('system이면 OS 설정 변화를 계속 따라간다', () => {
    useAppStore.getState().setThemePreference('system')

    renderHook(() => useThemeSync())

    // 대역이 `prefers-color-scheme: light`에 맞다고 답하므로 라이트로 풀린다.
    expect(useAppStore.getState().resolvedTheme).toBe('light')
    expect(listeners).toHaveLength(1)

    act(() => listeners[0]?.({ matches: false } as MediaQueryListEvent))
    expect(useAppStore.getState().resolvedTheme).toBe('dark')
  })

  it('사람이 직접 고른 뒤에는 OS 설정을 듣지 않는다', () => {
    useAppStore.getState().setThemePreference('light')

    renderHook(() => useThemeSync())

    expect(useAppStore.getState().resolvedTheme).toBe('light')
    expect(listeners).toHaveLength(0)
  })
})
