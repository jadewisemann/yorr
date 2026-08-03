import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { clearRoomSession, readRoomSession, saveRoomSession } from '@/room/roomSessionStorage'

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

  it('JSON이 아닌 값이나 객체가 아닌 값은 세션으로 인정하지 않는다', () => {
    const storage = createStorage()

    for (const raw of ['{broken', 'null', '"문자열"', '[]', '42']) {
      storage.setItem('yorr.room-session', raw)
      expect(readRoomSession(storage)).toBeNull()
    }
  })

  it('스냅샷이나 참가자 형태가 깨진 세션은 버린다', () => {
    const storage = createStorage()

    for (const snapshot of [
      'not-an-object',
      { roomId: creatorSession.roomId, phase: 'paused', players: [] },
      { roomId: creatorSession.roomId, phase: 'waiting', players: 'nope' },
      { roomId: creatorSession.roomId, phase: 'waiting', players: ['nope'] },
      {
        roomId: creatorSession.roomId,
        phase: 'waiting',
        players: [{ playerId: 'p1', nickname: '요르', status: 'ghost' }],
      },
    ]) {
      storage.setItem('yorr.room-session', JSON.stringify({ ...creatorSession, snapshot }))
      expect(readRoomSession(storage)).toBeNull()
    }
  })

  it('sessionStorage 접근 자체가 막힌 브라우저에서도 동작한다', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked')
      },
    })

    try {
      expect(readRoomSession()).toBeNull()
      expect(() => saveRoomSession(creatorSession)).not.toThrow()
      expect(() => clearRoomSession()).not.toThrow()
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'sessionStorage', descriptor)
      } else {
        Reflect.deleteProperty(globalThis, 'sessionStorage')
      }
    }
  })
})
