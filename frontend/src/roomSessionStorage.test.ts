import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { clearRoomSession, readRoomSession, saveRoomSession } from './roomSessionStorage'

const sessionTtlMs = 40 * 60 * 1000

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

function storedPayload(session: unknown, expiresAt = Date.now() + sessionTtlMs) {
  return JSON.stringify({ expiresAt, session })
}

describe('room session storage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and restores a valid room session', () => {
    const storage = createStorage()

    saveRoomSession(creatorSession, storage)

    expect(readRoomSession(storage)).toEqual(creatorSession)
  })

  it('restores an entered room while realtime snapshot is pending', () => {
    const storage = createStorage()
    const pendingSession = { ...creatorSession, snapshot: null }

    saveRoomSession(pendingSession, storage)

    expect(readRoomSession(storage)).toEqual(pendingSession)
  })

  it('discards an expired session and removes it from storage', () => {
    const storage = createStorage()
    saveRoomSession(creatorSession, storage)

    vi.advanceTimersByTime(sessionTtlMs)

    expect(readRoomSession(storage)).toBeNull()
    expect(storage.getItem('yorr.room-session')).toBeNull()
  })

  it('extends expiry on every save so an active session stays alive', () => {
    const storage = createStorage()
    saveRoomSession(creatorSession, storage)

    vi.advanceTimersByTime(sessionTtlMs - 60_000)
    saveRoomSession(creatorSession, storage)
    vi.advanceTimersByTime(sessionTtlMs - 60_000)

    expect(readRoomSession(storage)).toEqual(creatorSession)
  })

  it('rejects a legacy payload without an expiry envelope', () => {
    const storage = createStorage()
    storage.setItem('yorr.room-session', JSON.stringify(creatorSession))

    expect(readRoomSession(storage)).toBeNull()
  })

  it('rejects malformed or mismatched sessions', () => {
    const storage = createStorage()
    storage.setItem(
      'yorr.room-session',
      storedPayload({ ...creatorSession, roomId: 'different-room' }),
    )

    expect(readRoomSession(storage)).toBeNull()
  })

  it('rejects a session without an explicit room membership role', () => {
    const storage = createStorage()
    const { membershipRole: _membershipRole, ...sessionWithoutRole } = creatorSession
    storage.setItem('yorr.room-session', storedPayload(sessionWithoutRole))

    expect(readRoomSession(storage)).toBeNull()
  })

  it('clears a stored session', () => {
    const storage = createStorage()
    saveRoomSession(creatorSession, storage)

    clearRoomSession(storage)

    expect(readRoomSession(storage)).toBeNull()
  })

  it('does not throw when storage is blocked', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }

    expect(() => saveRoomSession(creatorSession, storage)).not.toThrow()
    expect(() => clearRoomSession(storage)).not.toThrow()
    expect(readRoomSession(storage)).toBeNull()
  })
})
