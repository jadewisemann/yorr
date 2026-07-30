import type { RoomMembershipRole, RoomSession } from '@/api/gameApi'
import type { Player, RoomPhase, RoomSnapshot } from '@/realtime/wsEvents'

const roomSessionStorageKey = 'yorr.room-session'
/**
 * 방 자체가 서버(Redis)에서 40분 TTL로 사라진다. 그보다 오래 남긴 세션은
 * 복구가 아니라 "이어서 하기 → 방 없음" 실패만 만들므로 수명을 방에 맞춘다.
 */
const roomSessionTtlMs = 40 * 60 * 1000
const roomPhases: readonly RoomPhase[] = ['waiting', 'playing', 'finished']
const playerStatuses = ['online', 'away', 'offline'] as const
const membershipRoles: readonly RoomMembershipRole[] = ['host', 'participant']

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 저장 봉투. 만료는 저장소의 관심사라 세션 계약(RoomSession)에 섞지 않는다. */
interface StoredRoomSession {
  session: RoomSession
  expiresAt: number
}

/**
 * 세션 토큰은 localStorage에 만료 시각과 함께 둔다.
 *
 * 새로고침만이 아니라 브라우저를 껐다 켠 뒤에도 진행 중이던 방으로 돌아갈 수 있어야 한다
 * (서버는 토큰을 24시간 보관하므로 클라이언트 사본만이 격차였다). 대신 계정 없는 참가자
 * 권한이 장기간 남지 않도록 저장할 때마다 방 수명만큼의 만료를 기록하고, 지나면 폐기한다.
 * 저장소가 복원돼도 자동 입장하지 않고 사용자가 명시적으로 "이어서 하기"를 고른 뒤에만
 * 토큰을 서버에 제시한다.
 */
export function readRoomSession(storage = getLocalStorage()) {
  if (!storage) return null

  try {
    const value: unknown = JSON.parse(storage.getItem(roomSessionStorageKey) ?? 'null')
    if (!isStoredRoomSession(value)) return null
    if (value.expiresAt <= Date.now()) {
      storage.removeItem(roomSessionStorageKey)
      return null
    }
    return value.session
  } catch {
    return null
  }
}

export function saveRoomSession(session: RoomSession, storage = getLocalStorage()) {
  if (!storage) return

  try {
    const stored: StoredRoomSession = { expiresAt: Date.now() + roomSessionTtlMs, session }
    storage.setItem(roomSessionStorageKey, JSON.stringify(stored))
  } catch {
    // Storage can be blocked in private browsing or embedded webviews.
  }
}

export function clearRoomSession(storage = getLocalStorage()) {
  if (!storage) return

  try {
    storage.removeItem(roomSessionStorageKey)
  } catch {
    // Clearing storage must not block leaving a room locally.
  }
}

function isStoredRoomSession(value: unknown): value is StoredRoomSession {
  if (!isRecord(value)) return false
  return (
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    isRoomSession(value.session)
  )
}

function isRoomSession(value: unknown): value is RoomSession {
  if (!isRecord(value)) return false
  return (
    isString(value.roomId) &&
    isString(value.roomCode) &&
    (value.gameId === null || isString(value.gameId)) &&
    isString(value.you) &&
    isString(value.nickname) &&
    membershipRoles.includes(value.membershipRole as RoomMembershipRole) &&
    isString(value.sessionToken) &&
    (value.snapshot === null ||
      (isRoomSnapshot(value.snapshot) && value.snapshot.roomId === value.roomId))
  )
}

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!isRecord(value)) return false
  return (
    isString(value.roomId) &&
    roomPhases.includes(value.phase as RoomPhase) &&
    Array.isArray(value.players) &&
    value.players.every(isPlayer)
  )
}

function isPlayer(value: unknown): value is Player {
  if (!isRecord(value)) return false
  return (
    isString(value.playerId) &&
    isString(value.nickname) &&
    playerStatuses.includes(value.status as (typeof playerStatuses)[number])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function getLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
