import type { Player, RoomPhase, RoomSnapshot } from '@/realtime/wsEvents'
import type { RoomMembershipRole, RoomSession } from '@/room/api/roomApi'

const roomSessionStorageKey = 'yorr.room-session'
const roomSessionTtlMs = 40 * 60 * 1000
const roomPhases: readonly RoomPhase[] = ['waiting', 'playing', 'finished']
const playerStatuses = ['online', 'away', 'offline'] as const
const membershipRoles: readonly RoomMembershipRole[] = ['host', 'participant', 'dashboard']

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface StoredRoomSession {
  session: RoomSession
  expiresAt: number
}

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
  } catch {}
}

export function clearRoomSession(storage = getLocalStorage()) {
  if (!storage) return

  try {
    storage.removeItem(roomSessionStorageKey)
  } catch {}
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
