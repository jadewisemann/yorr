import { useAppStore } from '@/store'
import type { ThemePreference } from '@/styles/theme'

/*
 * 화면 테마 선택. AccountMenu가 아니라 AccountDialog에 사는 이유 — 테마는 계정이
 * 아니라 **기기** 설정이라(localStorage 영속) 로그아웃 상태에서도 보여야 한다.
 *
 * role="radio" 버튼이 아니라 **네이티브 라디오**다(biome useSemanticElements).
 * 화살표 키 순회·그룹 포커스를 브라우저가 공짜로 준다 — ARIA로 다시 만들 이유가 없다.
 */

const OPTIONS: { label: string; value: ThemePreference }[] = [
  { label: '시스템', value: 'system' },
  { label: '다크', value: 'dark' },
  { label: '라이트', value: 'light' },
]

const segment =
  'flex min-h-tap cursor-pointer items-center justify-center rounded-chip border border-transparent text-xs font-semibold text-content-muted transition-[color,background-color,border-color,scale] duration-150 ease-out hover:text-content active:scale-[0.97] has-checked:border-border-strong has-checked:bg-surface-veil-raised has-checked:text-content has-focus-visible:outline-3 has-focus-visible:outline-landing-accent has-focus-visible:outline-offset-2'

export function ThemeRow() {
  const preference = useAppStore((state) => state.themePreference)
  const setThemePreference = useAppStore((state) => state.setThemePreference)

  return (
    <fieldset className="m-0 min-w-0 rounded-card border border-border bg-surface px-4 py-3.5">
      <legend className="sr-only">화면 테마</legend>
      <span aria-hidden="true" className="text-xs font-semibold text-content-muted">
        화면 테마
      </span>
      <div className="mt-2.5 grid grid-cols-3 gap-1">
        {OPTIONS.map((option) => (
          <label className={segment} key={option.value}>
            <input
              checked={preference === option.value}
              className="sr-only"
              name="theme-preference"
              onChange={() => setThemePreference(option.value)}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
