import type { RoomSession } from '@/api/gameApi'
import type { Player, RoomPhase, RoomSnapshot } from '@/realtime/wsEvents'

const roomSessionStorageKey = 'yorr.room-session'
const roomPhases: readonly RoomPhase[] = ['waiting', 'playing', 'finished']
const playerStatuses = ['online', 'away', 'offline'] as const

interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

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
    isString(value.you) &&
    isString(value.sessionToken) &&
    isRoomSnapshot(value.snapshot) &&
    value.snapshot.roomId === value.roomId
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
