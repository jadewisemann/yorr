import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AuthSession, clearAuthSession, readAuthSession, saveAuthSession } from './authSession'

const session: AuthSession = {
  userId: 'member-1',
  nickname: '카카오회원',
  sessionToken: 'token-1',
}

describe('authSession', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('saves and restores the session', () => {
    saveAuthSession(session)
    expect(readAuthSession()).toEqual(session)
  })

  /** 서버 세션이 30일 sliding이라 클라이언트도 같이 만료돼야 "로그인돼 보이는데 401"이 안 생긴다. */
  it('discards the session once it expires', () => {
    vi.useFakeTimers()
    saveAuthSession(session)

    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1)

    expect(readAuthSession()).toBeNull()
    expect(localStorage.getItem('yorr.auth-session')).toBeNull()
  })

  it('discards malformed payloads instead of throwing', () => {
    localStorage.setItem('yorr.auth-session', '{"session":{"userId":""},"expiresAt":"soon"}')
    expect(readAuthSession()).toBeNull()
  })

  /** 방 세션과 저장 자리를 나눠 둔 이유 — 방을 나가도 로그인은 남아야 한다. */
  it('does not share storage with the room session', () => {
    saveAuthSession(session)
    localStorage.removeItem('yorr.room-session')
    expect(readAuthSession()).toEqual(session)
  })

  it('clears the session on sign out', () => {
    saveAuthSession(session)
    clearAuthSession()
    expect(readAuthSession()).toBeNull()
  })
})
