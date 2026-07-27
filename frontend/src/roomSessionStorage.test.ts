import { describe, expect, it } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { clearRoomSession, readRoomSession, saveRoomSession } from './roomSessionStorage'

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('room session storage', () => {
  it('stores and restores a valid room session', () => {
    const storage = createStorage()

    saveRoomSession(creatorSession, storage)

    expect(readRoomSession(storage)).toEqual(creatorSession)
  })

  it('rejects malformed or mismatched sessions', () => {
    const storage = createStorage()
    storage.setItem(
      'yorr.room-session',
      JSON.stringify({ ...creatorSession, roomId: 'different-room' }),
    )

    expect(readRoomSession(storage)).toBeNull()
  })

  it('rejects a session without an explicit room membership role', () => {
    const storage = createStorage()
    const { membershipRole: _membershipRole, ...sessionWithoutRole } = creatorSession
    storage.setItem('yorr.room-session', JSON.stringify(sessionWithoutRole))

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
