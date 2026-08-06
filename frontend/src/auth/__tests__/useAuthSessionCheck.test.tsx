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

  /** "화면은 로그인, 요청은 401"인 상태를 없애는 게 이 훅의 존재 이유다. */
  it('clears a session the server no longer knows', async () => {
    useAppStore.getState().signIn(session)
    verifySession.mockResolvedValue(null)

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(useAppStore.getState().authSession).toBeNull())
    expect(localStorage.getItem('yorr.auth-session')).toBeNull()
    // 사용자가 한 일이 없다 — 안내를 띄우면 오히려 놀란다.
    expect(useAppStore.getState().appNotice).toBeNull()
  })

  /** 서버가 잠깐 안 뜬 것까지 로그아웃으로 취급하면 네트워크가 흔들릴 때마다 튕긴다. */
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
