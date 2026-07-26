const roomCodePattern = /^[A-Z0-9]{4,12}$/

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase()
}

export function getRoomCodeError(value: string) {
  if (value.length === 0) return '초대 코드를 입력해 주세요.'
  if (!roomCodePattern.test(value)) return '초대 코드는 영문과 숫자 4~12자로 입력해 주세요.'
  return null
}
