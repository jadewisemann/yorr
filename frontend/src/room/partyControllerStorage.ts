const partyRoomStorageKey = 'yorr.party-room'

export function savePartyRoom(roomCode: string) {
  try {
    globalThis.localStorage?.setItem(partyRoomStorageKey, roomCode)
  } catch {}
}

export function isPartyRoom(roomCode: string | undefined) {
  if (!roomCode) return false
  try {
    return globalThis.localStorage?.getItem(partyRoomStorageKey) === roomCode
  } catch {
    return false
  }
}
