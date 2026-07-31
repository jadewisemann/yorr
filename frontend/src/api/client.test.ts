import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { ApiError, apiRequest } from './client'

const PATH = '/probe'
const URL_PATTERN = `/api/v1${PATH}`

function respondWith(response: Response) {
  mockApiServer.use(http.post(URL_PATTERN, () => response))
}

async function failedRequest(response: Response) {
  respondWith(response)
  try {
    await apiRequest(PATH, { method: 'POST' })
  } catch (error) {
    return error as ApiError
  }
  throw new Error('요청이 실패하지 않았습니다.')
}

describe('apiRequest 성공 응답', () => {
  it('JSON 본문을 파싱해서 돌려준다', async () => {
    respondWith(HttpResponse.json({ ok: true }))

    await expect(apiRequest(PATH, { method: 'POST' })).resolves.toEqual({ ok: true })
  })

  it('204는 본문을 읽지 않고 undefined로 끝낸다', async () => {
    respondWith(new HttpResponse(null, { status: 204 }))

    await expect(apiRequest(PATH, { method: 'POST' })).resolves.toBeUndefined()
  })

  it('본문이 있으면 JSON Content-Type을 채우고, 호출부가 지정한 값은 그대로 둔다', async () => {
    const contentTypes: (string | null)[] = []
    mockApiServer.use(
      http.post(URL_PATTERN, ({ request }) => {
        contentTypes.push(request.headers.get('Content-Type'))
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await apiRequest(PATH, { method: 'POST', body: '{}' })
    await apiRequest(PATH, {
      method: 'POST',
      body: 'a=1',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    await apiRequest(PATH, { method: 'POST' })

    expect(contentTypes).toEqual(['application/json', 'application/x-www-form-urlencoded', null])
  })
})

describe('apiRequest 에러 매핑', () => {
  it('JSON 에러 본문의 code·message를 ApiError로 옮긴다', async () => {
    const error = await failedRequest(
      HttpResponse.json({ code: 'ROOM_FULL', message: '방이 가득 찼습니다' }, { status: 409 }),
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      code: 'ROOM_FULL',
      message: '방이 가득 찼습니다',
      payload: { code: 'ROOM_FULL' },
    })
  })

  it('message 없이 code만 오면 code를 메시지 자리에 쓴다', async () => {
    const error = await failedRequest(
      HttpResponse.json({ code: 'SESSION_EXPIRED' }, { status: 401 }),
    )

    expect(error.message).toBe('SESSION_EXPIRED')
    expect(error.code).toBe('SESSION_EXPIRED')
  })

  it('객체가 아닌 JSON 본문은 에러 payload로 인정하지 않는다', async () => {
    const fromArray = await failedRequest(HttpResponse.json(['nope'], { status: 500 }))
    const fromNull = await failedRequest(HttpResponse.json(null, { status: 500 }))

    for (const error of [fromArray, fromNull]) {
      expect(error.code).toBeUndefined()
      expect(error.payload).toBeUndefined()
      expect(error.message).toBe('API request failed with status 500')
    }
  })

  it('JSON 문자열 본문은 서버 텍스트 코드와 같은 규칙으로 매핑한다', async () => {
    const error = await failedRequest(HttpResponse.json('room_full', { status: 409 }))

    expect(error.code).toBe('ROOM_FULL')
    expect(error.message).toBe('room_full')
  })

  it('서버가 내려주는 snake_case 텍스트 코드를 프론트 코드로 매핑한다', async () => {
    const mapped = await Promise.all(
      ['room_not_found', 'room_full', 'game_started', 'invalid_nickname'].map(async (text) => {
        const error = await failedRequest(HttpResponse.text(text, { status: 400 }))
        return error.code
      }),
    )

    expect(mapped).toEqual([
      'ROOM_NOT_FOUND',
      'ROOM_FULL',
      'GAME_ALREADY_STARTED',
      'INVALID_NICKNAME',
    ])
  })

  it('매핑 표에 없는 텍스트는 대문자로 올려 코드로 쓴다', async () => {
    const error = await failedRequest(HttpResponse.text('teapot_overflow', { status: 418 }))

    expect(error).toMatchObject({
      status: 418,
      code: 'TEAPOT_OVERFLOW',
      message: 'teapot_overflow',
    })
  })

  it('빈 본문 에러는 상태 코드만으로 설명한다', async () => {
    const error = await failedRequest(new HttpResponse(null, { status: 502 }))

    expect(error.code).toBeUndefined()
    expect(error.message).toBe('API request failed with status 502')
  })

  it('JSON이라고 선언했지만 파싱되지 않는 본문은 조용히 버린다', async () => {
    const error = await failedRequest(
      new HttpResponse('<html>oops</html>', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(error.payload).toBeUndefined()
    expect(error.message).toBe('API request failed with status 500')
  })
})
