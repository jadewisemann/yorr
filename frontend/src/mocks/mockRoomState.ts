import type { RoomSnapshot } from '@/realtime/wsEvents'

const STORAGE_KEY = 'yorr.mock-room-state'

export function saveMockRoomSnapshot(snapshot: RoomSnapshot) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {}
}

export function loadMockRoomSnapshot(): RoomSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RoomSnapshot) : null
  } catch {
    return null
  }
}

export function clearMockRoomSnapshot() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {}
}
