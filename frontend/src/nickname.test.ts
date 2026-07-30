import { describe, expect, it, vi } from 'vitest'
import {
  generateNickname,
  getNicknameError,
  NICKNAME_MAX_LENGTH,
  normalizeNickname,
  readSavedNickname,
  resolveNickname,
  saveNickname,
} from './nickname'

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
})
