import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { toUserError } from './userError'

describe('toUserError', () => {
  it('maps room errors to a recoverable Korean message', () => {
    expect(toUserError(new ApiError(404, 'raw server message', 'ROOM_NOT_FOUND'))).toMatchObject({
      message: '존재하지 않거나 더 이상 사용할 수 없는 방이에요.',
      canChangeRoom: true,
    })
  })

  it('does not expose a raw network error', () => {
    expect(toUserError(new TypeError('Failed to fetch')).message).toBe(
      '네트워크 연결을 확인하고 다시 시도해 주세요.',
    )
  })
})
