import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifySession } from '@/auth/api/authApi'
import { useAuthSessionCheck } from '@/auth/model/useAuthSessionCheck'
import { useAppStore } from '@/store'

vi.mock('@/auth/api/authApi', () => ({ verifySession: vi.fn() }))

const SESSION = { nickname: '요르', sessionToken: 'token-1', userId: 'user-1' }

afterEach(() => {
  useAppStore.getState().signOut()
  vi.clearAllMocks()
})

describe('useAuthSessionCheck', () => {
  it('로그인하지 않았으면 서버에 묻지 않는다', () => {
    renderHook(() => useAuthSessionCheck())

    expect(verifySession).not.toHaveBeenCalled()
  })

  it('세션이 죽어 있으면 로그아웃시킨다', async () => {
    useAppStore.getState().signIn(SESSION)
    vi.mocked(verifySession).mockResolvedValue(null)

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(useAppStore.getState().authSession).toBeNull())
  })

  it('그 사이 이름이 바뀌었으면 새 이름으로 맞춘다', async () => {
    useAppStore.getState().signIn(SESSION)
    vi.mocked(verifySession).mockResolvedValue('새이름')

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(useAppStore.getState().authSession?.nickname).toBe('새이름'))
  })

  it('이름이 그대로면 세션을 건드리지 않는다', async () => {
    useAppStore.getState().signIn(SESSION)
    vi.mocked(verifySession).mockResolvedValue(SESSION.nickname)
    const before = useAppStore.getState().authSession

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(verifySession).toHaveBeenCalled())
    expect(useAppStore.getState().authSession).toBe(before)
  })

  it('한 번 물어본 뒤에는 다시 묻지 않는다', async () => {
    useAppStore.getState().signIn(SESSION)
    vi.mocked(verifySession).mockResolvedValue(SESSION.nickname)

    const { rerender } = renderHook(() => useAuthSessionCheck())
    rerender()

    await waitFor(() => expect(verifySession).toHaveBeenCalledOnce())
  })

  it('물어보다 실패해도 로그인을 잃지 않는다', async () => {
    useAppStore.getState().signIn(SESSION)
    vi.mocked(verifySession).mockRejectedValue(new Error('네트워크'))

    renderHook(() => useAuthSessionCheck())

    await waitFor(() => expect(verifySession).toHaveBeenCalled())
    expect(useAppStore.getState().authSession?.nickname).toBe(SESSION.nickname)
  })
})
