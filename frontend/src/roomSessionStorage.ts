import type { RoomMembershipRole, RoomSession } from '@/api/gameApi'
import type { Player, RoomPhase, RoomSnapshot } from '@/realtime/wsEvents'

const roomSessionStorageKey = 'yorr.room-session'
const roomPhases: readonly RoomPhase[] = ['waiting', 'playing', 'finished']
const playerStatuses = ['online', 'away', 'offline'] as const
const membershipRoles: readonly RoomMembershipRole[] = ['host', 'participant']

interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * 세션 토큰은 localStorage가 아니라 sessionStorage에만 둔다.
 *
 * 새로고침과 같은 탭의 짧은 복구에는 살아 있어야 하지만, 브라우저를 닫은 뒤까지 계정 없는
 * 참가자 권한을 장기간 남길 이유는 없다. 저장소가 복원돼도 자동 입장하지 않고 사용자가
 * 명시적으로 "이어서 하기"를 고른 뒤에만 토큰을 서버에 제시한다.
 */
export function readRoomSession(storage = getSessionStorage()) {
  if (!storage) return null

  try {
    const value: unknown = JSON.parse(storage.getItem(roomSessionStorageKey) ?? 'null')
    return isRoomSession(value) ? value : null
  } catch {
    return null
  }
}

export function saveRoomSession(session: RoomSession, storage = getSessionStorage()) {
  if (!storage) return

  try {
    storage.setItem(roomSessionStorageKey, JSON.stringify(session))
  } catch {
    // Storage can be blocked in private browsing or embedded webviews.
  }
}

export function clearRoomSession(storage = getSessionStorage()) {
  if (!storage) return

  try {
    storage.removeItem(roomSessionStorageKey)
  } catch {
    // Clearing storage must not block leaving a room locally.
  }
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

function getSessionStorage(): SessionStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}
