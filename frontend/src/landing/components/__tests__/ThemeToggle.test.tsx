import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/landing/components/EntryPage/parts'
import { useAppStore } from '@/store'

afterEach(() => {
  useAppStore.getState().setThemePreference('system')
  localStorage.removeItem('yorr.theme')
  document.documentElement.removeAttribute('data-theme')
})

describe('ThemeToggle', () => {
  it('누르면 store·영속·DOM이 함께 라이트로 바뀐다', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: '라이트 모드로 바꾸기' }))

    expect(useAppStore.getState().themePreference).toBe('light')
    expect(localStorage.getItem('yorr.theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('다시 누르면 다크로 돌아가며 data-theme 속성이 지워진다 — 없는 것이 곧 다크다', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: '라이트 모드로 바꾸기' }))
    await user.click(screen.getByRole('button', { name: '다크 모드로 바꾸기' }))

    expect(useAppStore.getState().themePreference).toBe('dark')
    expect(localStorage.getItem('yorr.theme')).toBe('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
