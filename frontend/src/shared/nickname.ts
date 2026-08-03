export const NICKNAME_MAX_LENGTH = 12

const adjectives = [
  '느긋한',
  '수상한',
  '용감한',
  '졸린',
  '신나는',
  '재빠른',
  '씩씩한',
  '엉뚱한',
] as const

const nouns = ['주사위', '선장', '펭귄', '해적', '문어', '갈매기', '고래', '돛단배'] as const

const allowedNicknamePattern = /^[\p{L}\p{N} ]+$/u
const nicknameStorageKey = 'yorr.nickname'

interface NicknameStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function generateNickname(random: () => number = Math.random) {
  const adjective = adjectives[toIndex(random(), adjectives.length)]
  const noun = nouns[toIndex(random(), nouns.length)]
  return `${adjective} ${noun}`
}

export function normalizeNickname(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

export function getNicknameError(value: string) {
  if (value.length === 0) return '닉네임을 한 글자 이상 입력해 주세요.'
  if (Array.from(value).length > NICKNAME_MAX_LENGTH) {
    return `닉네임은 ${NICKNAME_MAX_LENGTH}자 이하로 입력해 주세요.`
  }
  if (!allowedNicknamePattern.test(value)) {
    return '닉네임에는 문자, 숫자, 공백만 사용할 수 있어요.'
  }
  return null
}

export function resolveNickname(input: string, suggestion: string) {
  const nickname = normalizeNickname(input) || normalizeNickname(suggestion)
  return { nickname, error: getNicknameError(nickname) }
}

export function readSavedNickname(storage = getSessionStorage()) {
  if (!storage) return null

  try {
    const savedNickname = storage.getItem(nicknameStorageKey)
    if (savedNickname === null) return null

    const nickname = normalizeNickname(savedNickname)
    return getNicknameError(nickname) === null ? nickname : null
  } catch {
    return null
  }
}

export function saveNickname(nickname: string, storage = getSessionStorage()) {
  if (!storage) return

  try {
    storage.setItem(nicknameStorageKey, nickname)
  } catch {
    // Storage can be blocked in private browsing or embedded webviews.
  }
}

function toIndex(randomValue: number, length: number) {
  return Math.min(Math.floor(Math.max(randomValue, 0) * length), length - 1)
}

function getSessionStorage(): NicknameStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}
