import { cn } from '@/shared/cn'
import { useAppStore } from '@/store'
import type { ThemePreference } from '@/styles/theme'

/*
 * 화면 테마 선택. AccountMenu가 아니라 AccountDialog에 사는 이유 — 테마는 계정이
 * 아니라 **기기** 설정이라(localStorage 영속) 로그아웃 상태에서도 보여야 한다.
 */

const OPTIONS: { label: string; value: ThemePreference }[] = [
  { label: '시스템', value: 'system' },
  { label: '다크', value: 'dark' },
  { label: '라이트', value: 'light' },
]

const segment =
  'min-h-tap cursor-pointer rounded-chip border text-xs font-semibold transition-[color,background-color,border-color,scale] duration-150 ease-out focus-visible:outline-3 focus-visible:outline-landing-accent focus-visible:outline-offset-2 active:scale-[0.97]'
const segmentOn = 'border-border-strong bg-surface-veil-raised text-content'
const segmentOff = 'border-transparent bg-transparent text-content-muted hover:text-content'

export function ThemeRow() {
  const preference = useAppStore((state) => state.themePreference)
  const setThemePreference = useAppStore((state) => state.setThemePreference)

  return (
    <div className="grid gap-2.5 rounded-card border border-border bg-surface px-4 py-3.5">
      <span className="text-xs font-semibold text-content-muted" id="theme-row-label">
        화면 테마
      </span>
      <div aria-labelledby="theme-row-label" className="grid grid-cols-3 gap-1" role="radiogroup">
        {OPTIONS.map((option) => (
          <button
            aria-checked={preference === option.value}
            className={cn(segment, preference === option.value ? segmentOn : segmentOff)}
            key={option.value}
            onClick={() => setThemePreference(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
