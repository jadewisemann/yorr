import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthSessionCheck } from '@/auth/model/useAuthSessionCheck'
import { useAppStore } from '@/store'

const { verifySession } = vi.hoisted(() => ({ verifySession: vi.fn() }))

vi.mock('@/auth/api/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/api/authApi')>()),
  verifySession: (token: string) => verifySession(token),
}))

const session = { userId: 'member-1', nickname: '카카오회원', sessionToken: 'token-1' }

describe('useAuthSessionCheck', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().signOut()
  })

  afterEach(() => verifySession.mockReset())

  it('does nothing when nobody is signed in', () => {
    renderHook(() => useAuthSessionCheck())
    expect(verifySession).not.toHaveBeenCalled()
  })

  it('keeps the session when the server still knows it', async () => {
    useAppStore.getState().signIn(session)
    verifySession.mockResolvedValue('카카오회원')

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(verifySession).toHaveBeenCalledWith('token-1'))
    expect(useAppStore.getState().authSession).toEqual(session)
  })

  it('clears a session the server no longer knows', async () => {
    useAppStore.getState().signIn(session)
    verifySession.mockResolvedValue(null)

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(useAppStore.getState().authSession).toBeNull())
    expect(localStorage.getItem('yorr.auth-session')).toBeNull()
    expect(useAppStore.getState().appNotice).toBeNull()
  })

  it('keeps the session when the check itself fails', async () => {
    useAppStore.getState().signIn(session)
    verifySession.mockRejectedValue(new Error('network down'))

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(verifySession).toHaveBeenCalled())
    expect(useAppStore.getState().authSession).toEqual(session)
  })

  it('takes the nickname the server reports as the newer one', async () => {
    useAppStore.getState().signIn(session)
    verifySession.mockResolvedValue('바뀐닉네임')

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => {
      expect(useAppStore.getState().authSession?.nickname).toBe('바뀐닉네임')
    })
  })
})
