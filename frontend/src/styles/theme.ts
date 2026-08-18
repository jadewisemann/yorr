/**
 * 테마 — 사용자 선택(preference)과 실제 적용값(resolved)을 나눠 다룬다.
 *
 * 나누는 이유: "시스템 따라가기"를 고른 사용자는 OS 설정이 바뀔 때 따라가야 하는데,
 * 저장해야 하는 것은 `light`가 아니라 **`system`이라는 선택**이다. 하나로 합치면
 * 시스템을 따라가기로 한 사실이 첫 적용 순간에 지워진다.
 *
 * CSS 쪽 계약은 `tokens.css` — `:root`가 다크고 `[data-theme="light"]`가 오버라이드다.
 * 그래서 `dark`를 적용할 때는 속성을 **지운다**(다크가 기본이므로 없는 것이 곧 다크다).
 */
export type ThemePreference = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

const storageKey = 'yorr.theme'

/** `--ds-color-canvas`와 같은 값. 모바일 주소창 색이라 다르면 화면이 잘려 보인다. */
const themeColors: Record<ResolvedTheme, string> = {
  dark: '#08090a',
  light: '#ebebe8',
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light'
}

export function readThemePreference(): ThemePreference {
  const raw = storage()?.getItem(storageKey)
  return isPreference(raw) ? raw : 'system'
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    storage()?.setItem(storageKey, preference)
  } catch {
    // Safari 프라이빗 모드는 setItem에서 던진다 — 저장 실패가 전환을 막지는 않는다.
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  // matchMedia가 없는 환경(jsdom 기본·구형 웹뷰)에서는 기본 테마인 다크로 떨어진다.
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  if (theme === 'light') root.setAttribute('data-theme', 'light')
  else root.removeAttribute('data-theme')

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme])
}

/**
 * `system`을 고른 동안만 OS 설정 변화를 따라간다. 반환값은 구독 해지 함수.
 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  const query = globalThis.matchMedia?.('(prefers-color-scheme: light)')
  if (!query) return () => undefined

  const handle = (event: MediaQueryListEvent) => onChange(event.matches ? 'light' : 'dark')
  query.addEventListener('change', handle)
  return () => query.removeEventListener('change', handle)
}
