import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { toUserError } from '@/shared/api/userError'

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

  it('만료된 세션만 로컬 토큰까지 지우게 한다', () => {
    expect(toUserError(new ApiError(401, 'expired', 'SESSION_EXPIRED'))).toEqual({
      message: '입장 정보가 만료됐어요. 방에 다시 참가해 주세요.',
      canChangeRoom: true,
      clearsSession: true,
    })
  })

  it('다른 방으로 옮겨야 풀리는 오류와 재시도로 풀리는 오류를 구분한다', () => {
    const changeRoom = ['ROOM_NOT_FOUND', 'ROOM_FULL', 'GAME_ALREADY_STARTED'].map(
      (code) => toUserError(new ApiError(400, code, code)).canChangeRoom,
    )
    const retry = ['RATE_LIMITED', 'INTERNAL'].map(
      (code) => toUserError(new ApiError(500, code, code)).canChangeRoom,
    )

    expect(changeRoom).toEqual([true, true, true])
    expect(retry).toEqual([false, false])
  })

  it('처리 문구가 정해지지 않은 서버 오류는 재시도 안내로 모은다', () => {
    // 코드가 없는 응답과 매핑에 없는 코드 모두 원문을 노출하지 않는다.
    const withoutCode = toUserError(new ApiError(500, 'Internal Server Error'))
    const unknownCode = toUserError(new ApiError(409, 'weird', 'TEAPOT_OVERFLOW'))

    for (const userError of [withoutCode, unknownCode]) {
      expect(userError).toEqual({
        message: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
        canChangeRoom: false,
        clearsSession: false,
      })
    }
  })
})
