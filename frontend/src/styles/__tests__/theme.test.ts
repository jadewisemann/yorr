import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  watchSystemTheme,
} from '@/styles/theme'

function stubMatchMedia(prefersLight: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: prefersLight,
    addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) =>
      listeners.add(handler),
    removeEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) =>
      listeners.delete(handler),
  }
  vi.stubGlobal('matchMedia', () => query)
  return { listeners }
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('테마 선택 저장', () => {
  it('저장된 값이 없거나 알 수 없으면 system이다', () => {
    expect(readThemePreference()).toBe('system')
    localStorage.setItem('yorr.theme', 'sepia')
    expect(readThemePreference()).toBe('system')
  })

  it('선택을 저장하고 되읽는다', () => {
    saveThemePreference('light')
    expect(readThemePreference()).toBe('light')
  })
})

describe('resolveTheme', () => {
  it('명시 선택은 시스템 설정을 무시한다', () => {
    stubMatchMedia(true)
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('system은 시스템 설정을 따른다', () => {
    stubMatchMedia(true)
    expect(resolveTheme('system')).toBe('light')
    stubMatchMedia(false)
    expect(resolveTheme('system')).toBe('dark')
  })

  it('matchMedia가 없는 환경은 기본 테마인 다크로 떨어진다', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveTheme('system')).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('다크는 속성을 지운다 — :root가 곧 다크라 없는 것이 기본이다', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.append(meta)

    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(meta.getAttribute('content')).toBe('#ebebe8')

    applyTheme('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(meta.getAttribute('content')).toBe('#08090a')
    meta.remove()
  })
})

describe('watchSystemTheme', () => {
  it('시스템 변화를 전달하고, 해지하면 더 받지 않는다', () => {
    const { listeners } = stubMatchMedia(false)
    const onChange = vi.fn()
    const stop = watchSystemTheme(onChange)

    for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent)
    expect(onChange).toHaveBeenCalledWith('light')

    stop()
    expect(listeners.size).toBe(0)
  })
})
