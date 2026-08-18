import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { applyTheme, resolveTheme, watchSystemTheme } from '@/styles/theme'

/**
 * 첫 적용은 `index.html`의 프리페인트 스크립트가 이미 했다 — 여기서 하면 첫 프레임이
 * 다크로 그려졌다가 바뀐다(라이트를 고른 사용자에게 흰 화면 전 검은 깜빡임).
 * 이 훅이 맡는 것은 **그 뒤의 변화**뿐이다: `system`을 고른 동안 OS 설정을 따라간다.
 */
export function useThemeSync(): void {
  const preference = useAppStore((state) => state.themePreference)

  useEffect(() => {
    // 다른 탭에서 바꿨거나 프리페인트가 못 돈 경우를 맞춰 둔다(멱등).
    applyTheme(resolveTheme(preference))
    if (preference !== 'system') return
    return watchSystemTheme(applyTheme)
  }, [preference])
}
