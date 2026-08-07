/**
 * 로그인 세션 저장소.
 *
 * 방 세션(`yorr.room-session`)과 <b>일부러 분리한다</b>. 둘은 수명도 의미도 다르다 —
 * 방 세션은 한 판을 위해 40분 살고 방을 나가면 지워지지만, 로그인은 방과 무관하게 남아야
 * 한다. 같은 자리에 두면 방을 나갈 때 로그인까지 풀린다.
 *
 * 서버 세션은 30일 sliding TTL이므로 클라이언트 만료도 거기 맞춘다. 이 값이 더 길면
 * "로그인돼 보이는데 요청은 401"인 상태만 만든다.
 */
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
    // 사파리 프라이빗 모드처럼 접근 자체가 던지는 환경이 있다. 로그인만 안 될 뿐 앱은 돌아야 한다.
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
