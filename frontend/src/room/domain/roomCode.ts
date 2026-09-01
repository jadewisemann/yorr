const roomCodePattern = /^[A-Z0-9]{4,12}$/

const ROOM_CODE_MAX_LENGTH = 12

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase()
}

export function sanitizeRoomCodeInput(value: string) {
  return extractRoomCode(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_MAX_LENGTH)
}

function extractRoomCode(value: string) {
  const fromQuery = /[?&]code=([^&#\s]*)/i.exec(value)
  if (fromQuery) return fromQuery[1] ?? ''
  if (value.includes('://')) return ''
  return value
}

export function isCompleteRoomCode(value: string) {
  return getRoomCodeError(value) === null
}

export function getRoomCodeError(value: string) {
  if (value.length === 0) return '초대 코드를 입력해 주세요.'
  if (!roomCodePattern.test(value)) return '초대 코드는 영문과 숫자 4~12자로 입력해 주세요.'
  return null
}
