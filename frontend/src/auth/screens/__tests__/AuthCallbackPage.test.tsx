import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCallbackPage } from '@/auth/screens/AuthCallbackPage'
import { useAppStore } from '@/store'
import { navigateSpy } from '@/test/routerDouble'

const { exchangeLoginCode } = vi.hoisted(() => ({ exchangeLoginCode: vi.fn() }))

vi.mock('@tanstack/react-router', async () =>
  (await import('@/test/routerDouble')).routerWithNavigateSpy(),
)

vi.mock('@/auth/api/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/api/authApi')>()),
  exchangeLoginCode: (code: string) => exchangeLoginCode(code),
}))

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().signOut()
    useAppStore.getState().setAppNotice(null)
  })

  afterEach(() => {
    navigateSpy.mockReset()
    exchangeLoginCode.mockReset()
  })

  it('exchanges the login code, keeps the session, and returns home', async () => {
    exchangeLoginCode.mockResolvedValue({
      userId: 'member-1',
      nickname: '카카오회원',
      sessionToken: 'token-1',
    })

    render(<AuthCallbackPage code="one-time-code" error={undefined} />)

    expect(screen.getByRole('status')).toHaveTextContent('로그인하는 중이에요')
    await waitFor(() => {
      expect(useAppStore.getState().authSession?.nickname).toBe('카카오회원')
    })
    expect(localStorage.getItem('yorr.auth-session')).toContain('token-1')
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('exchanges the code only once even if the effect runs again', async () => {
    exchangeLoginCode.mockResolvedValue({
      userId: 'member-1',
      nickname: '카카오회원',
      sessionToken: 'token-1',
    })

    const { rerender } = render(<AuthCallbackPage code="one-time-code" error={undefined} />)
    rerender(<AuthCallbackPage code="one-time-code" error={undefined} />)

    await waitFor(() => expect(navigateSpy).toHaveBeenCalled())
    expect(exchangeLoginCode).toHaveBeenCalledTimes(1)
  })

  it('shows the reason and goes home when the callback reports a failure', async () => {
    render(<AuthCallbackPage code={undefined} error="canceled" />)

    await waitFor(() => {
      expect(useAppStore.getState().appNotice).toBe('로그인을 취소했어요.')
    })
    expect(exchangeLoginCode).not.toHaveBeenCalled()
    expect(useAppStore.getState().authSession).toBeNull()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('recovers when the code is already used or expired', async () => {
    exchangeLoginCode.mockRejectedValue(new Error('401'))

    render(<AuthCallbackPage code="stale-code" error={undefined} />)

    await waitFor(() => {
      expect(useAppStore.getState().appNotice).toBe(
        '로그인을 마무리하지 못했어요. 다시 시도해 주세요.',
      )
    })
    expect(useAppStore.getState().authSession).toBeNull()
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/', replace: true })
  })
})
