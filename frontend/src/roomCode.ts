const roomCodePattern = /^[A-Z0-9]{4,12}$/

export const ROOM_CODE_MAX_LENGTH = 12

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase()
}

/** 랜딩 코드 입력은 타이핑·붙여넣기 즉시 정규화한다: 대문자 영숫자만, 최대 길이까지. */
export function sanitizeRoomCodeInput(value: string) {
  return extractRoomCode(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_MAX_LENGTH)
}

/**
 * 초대 링크를 통째로 붙여넣는 흐름이 실제로 잦다(초대 링크가 주 진입 경로다).
 * 링크를 그냥 정규화하면 `https://yorr.app/join?code=YORR64`가 `HTTPSYORRAPP`가 되는데,
 * 이게 4~12자 영숫자 패턴을 통과해버려서 없는 방으로 참가를 시도하게 된다.
 */
function extractRoomCode(value: string) {
  const fromQuery = /[?&]code=([^&#\s]*)/i.exec(value)
  if (fromQuery) return fromQuery[1] ?? ''
  // code 파라미터가 없는 URL은 건질 게 없다. 그럴듯한 가짜 코드를 만드느니 비운다.
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
