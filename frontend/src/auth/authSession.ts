const authSessionStorageKey = 'yorr.auth-session'
const authSessionTtlMs = 30 * 24 * 60 * 60 * 1000

export interface AuthSession {
  userId: string
  nickname: string
  sessionToken: string
}

interface StoredAuthSession {
  expiresAt: number
  session: AuthSession
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readAuthSession(): AuthSession | null {
  const store = storage()
  if (!store) return null

  const raw = store.getItem(authSessionStorageKey)
  if (!raw) return null

  try {
    const value: unknown = JSON.parse(raw)
    if (!isStoredAuthSession(value)) {
      store.removeItem(authSessionStorageKey)
      return null
    }
    if (value.expiresAt <= Date.now()) {
      store.removeItem(authSessionStorageKey)
      return null
    }
    return value.session
  } catch {
    store.removeItem(authSessionStorageKey)
    return null
  }
}

export function saveAuthSession(session: AuthSession) {
  const store = storage()
  if (!store) return
  const stored: StoredAuthSession = { expiresAt: Date.now() + authSessionTtlMs, session }
  store.setItem(authSessionStorageKey, JSON.stringify(stored))
}

export function clearAuthSession() {
  storage()?.removeItem(authSessionStorageKey)
}

function isStoredAuthSession(value: unknown): value is StoredAuthSession {
  if (typeof value !== 'object' || value === null) return false
  const stored = value as Partial<StoredAuthSession>
  return (
    typeof stored.expiresAt === 'number' &&
    Number.isFinite(stored.expiresAt) &&
    isAuthSession(stored.session)
  )
}

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) return false
  const session = value as Partial<AuthSession>
  return (
    typeof session.userId === 'string' &&
    typeof session.nickname === 'string' &&
    typeof session.sessionToken === 'string' &&
    session.userId.length > 0 &&
    session.sessionToken.length > 0
  )
}
