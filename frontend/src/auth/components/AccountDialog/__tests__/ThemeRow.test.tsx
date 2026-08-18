import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeRow } from '@/auth/components/AccountDialog/ThemeRow'
import { useAppStore } from '@/store'

afterEach(() => {
  useAppStore.getState().setThemePreference('system')
  localStorage.removeItem('yorr.theme')
  document.documentElement.removeAttribute('data-theme')
})

describe('ThemeRow', () => {
  it('그룹으로 노출되고 현재 선택이 체크된다', () => {
    render(<ThemeRow />)

    const group = screen.getByRole('group', { name: '화면 테마' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '시스템', checked: true })).toBeInTheDocument()
  })

  it('선택하면 store·영속·DOM이 함께 바뀐다', async () => {
    const user = userEvent.setup()
    render(<ThemeRow />)

    await user.click(screen.getByRole('radio', { name: '라이트' }))

    expect(screen.getByRole('radio', { name: '라이트', checked: true })).toBeInTheDocument()
    expect(useAppStore.getState().themePreference).toBe('light')
    expect(localStorage.getItem('yorr.theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('다크를 고르면 data-theme 속성이 지워진다 — 없는 것이 곧 다크다', async () => {
    const user = userEvent.setup()
    render(<ThemeRow />)

    await user.click(screen.getByRole('radio', { name: '라이트' }))
    await user.click(screen.getByRole('radio', { name: '다크' }))

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem('yorr.theme')).toBe('dark')
  })
})
