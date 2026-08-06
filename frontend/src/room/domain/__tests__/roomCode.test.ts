import { describe, expect, it } from 'vitest'
import {
  getRoomCodeError,
  isCompleteRoomCode,
  normalizeRoomCode,
  sanitizeRoomCodeInput,
} from '@/room/domain/roomCode'

describe('room code rules', () => {
  it('normalizes a room code from text input or query string', () => {
    expect(normalizeRoomCode(' yorr64 ')).toBe('YORR64')
  })

  it('accepts only letters and numbers between four and twelve characters', () => {
    expect(getRoomCodeError('YORR64')).toBeNull()
    expect(getRoomCodeError('요르64')).toBe('초대 코드는 영문과 숫자 4~12자로 입력해 주세요.')
    expect(getRoomCodeError('ABC')).toBe('초대 코드는 영문과 숫자 4~12자로 입력해 주세요.')
  })

  it('strips anything a room code cannot contain while typing or pasting', () => {
    expect(sanitizeRoomCodeInput('yo!r-r 64')).toBe('YORR64')
    expect(sanitizeRoomCodeInput('요르abc')).toBe('ABC')
  })

  it('caps the input at the maximum code length', () => {
    expect(sanitizeRoomCodeInput('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKL')
  })

  it('takes the code out of a pasted invite link', () => {
    expect(sanitizeRoomCodeInput('https://yorr.app/join?code=YORR64')).toBe('YORR64')
    expect(sanitizeRoomCodeInput('https://yorr.app/join?code=yorr64&ref=kakao')).toBe('YORR64')
  })

  it('refuses to invent a code from a link that has none', () => {
    // 그냥 정규화하면 'HTTPSYORRAPP'가 되어 4~12자 규칙을 통과한다 — 없는 방으로 보내게 된다.
    expect(sanitizeRoomCodeInput('https://yorr.app/join')).toBe('')
    expect(isCompleteRoomCode(sanitizeRoomCodeInput('https://yorr.app/join'))).toBe(false)
  })

  it('enables joining only once the code is long enough', () => {
    expect(isCompleteRoomCode('ABC')).toBe(false)
    expect(isCompleteRoomCode('ABCD')).toBe(true)
    expect(isCompleteRoomCode('YORR64')).toBe(true)
  })
})
