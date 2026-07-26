import { describe, expect, it } from 'vitest'
import { getRoomCodeError, normalizeRoomCode } from './roomCode'

describe('room code rules', () => {
  it('normalizes a room code from text input or query string', () => {
    expect(normalizeRoomCode(' yorr64 ')).toBe('YORR64')
  })

  it('accepts only letters and numbers between four and twelve characters', () => {
    expect(getRoomCodeError('YORR64')).toBeNull()
    expect(getRoomCodeError('요르64')).toBe('초대 코드는 영문과 숫자 4~12자로 입력해 주세요.')
    expect(getRoomCodeError('ABC')).toBe('초대 코드는 영문과 숫자 4~12자로 입력해 주세요.')
  })
})
