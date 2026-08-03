import { describe, expect, it, vi } from 'vitest'
import {
  generateNickname,
  getNicknameError,
  NICKNAME_MAX_LENGTH,
  normalizeNickname,
  readSavedNickname,
  resolveNickname,
  saveNickname,
} from '@/auth/nickname'

describe('nickname rules', () => {
  it('generates a stable adjective and noun combination from injected randomness', () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.999)

    expect(generateNickname(random)).toBe('느긋한 돛단배')
  })

  it('normalizes Unicode and surrounding or repeated whitespace', () => {
    expect(normalizeNickname('  요르\t 선장  ')).toBe('요르 선장')
  })

  it('accepts letters, numbers, and spaces within the length limit', () => {
    expect(getNicknameError('요르 Player 1')).toBeNull()
  })

  it('explains invalid characters and excessive length', () => {
    expect(getNicknameError('요르<script>')).toBe('닉네임에는 문자, 숫자, 공백만 사용할 수 있어요.')
    expect(getNicknameError('가'.repeat(NICKNAME_MAX_LENGTH + 1))).toBe(
      `닉네임은 ${NICKNAME_MAX_LENGTH}자 이하로 입력해 주세요.`,
    )
  })

  it('uses the displayed suggestion when the input is blank', () => {
    expect(resolveNickname('   ', '느긋한 주사위')).toEqual({
      nickname: '느긋한 주사위',
      error: null,
    })
  })

  it('입력과 추천이 모두 비면 최소 길이 안내로 막는다', () => {
    expect(resolveNickname('   ', '   ')).toEqual({
      nickname: '',
      error: '닉네임을 한 글자 이상 입력해 주세요.',
    })
  })

  it('길이는 코드 유닛이 아니라 글자 수로 센다', () => {
    // 이모지 한 글자를 두 글자로 세면 12자 한도가 사람 기준과 어긋난다.
    expect(getNicknameError('가'.repeat(NICKNAME_MAX_LENGTH))).toBeNull()
    expect(getNicknameError('🎲'.repeat(NICKNAME_MAX_LENGTH))).toBe(
      '닉네임에는 문자, 숫자, 공백만 사용할 수 있어요.',
    )
  })
})

describe('nickname session storage', () => {
  it('stores and restores a valid nickname', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }

    saveNickname('느긋한 주사위', storage)

    expect(readSavedNickname(storage)).toBe('느긋한 주사위')
  })

  it('ignores unavailable storage', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }

    expect(() => saveNickname('요르', storage)).not.toThrow()
    expect(readSavedNickname(storage)).toBeNull()
  })

  it('저장된 값이 규칙을 어기면 복원하지 않는다', () => {
    const values = new Map<string, string>([['yorr.nickname', '요르<script>']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    }

    expect(readSavedNickname(storage)).toBeNull()
  })

  it('sessionStorage 접근 자체가 막힌 브라우저에서도 동작한다', () => {
    const restore = blockSessionStorage()

    try {
      expect(readSavedNickname()).toBeNull()
      expect(() => saveNickname('요르')).not.toThrow()
    } finally {
      restore()
    }
  })
})

/** 임베드 웹뷰·시크릿 모드처럼 sessionStorage 접근이 예외를 던지는 환경을 흉내낸다. */
function blockSessionStorage() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('storage blocked')
    },
  })

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, 'sessionStorage', descriptor)
      return
    }
    Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
}
