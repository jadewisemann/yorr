import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { ApiError, apiRequest } from './client'

const PATH = '/core-probe'
const URL_PATTERN = `/api/v1${PATH}`

describe('core apiRequest', () => {
  it('JSON 응답을 파싱해 돌려준다', async () => {
    mockApiServer.use(http.get(URL_PATTERN, () => HttpResponse.json({ ok: true })))

    await expect(apiRequest(PATH)).resolves.toEqual({ ok: true })
  })

  it('JSON Content-Type을 기본으로 채우되 호출부 헤더가 우선한다', async () => {
    const headers: Array<string | null> = []
    mockApiServer.use(
      http.post(URL_PATTERN, ({ request }) => {
        headers.push(request.headers.get('Content-Type'))
        headers.push(request.headers.get('X-User-Id'))
        return HttpResponse.json({})
      }),
    )

    await apiRequest(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-User-Id': 'player-1' },
    })

    expect(headers).toEqual(['text/plain', 'player-1'])
  })

  it('실패 응답은 상태 코드를 담은 ApiError로 올린다', async () => {
    mockApiServer.use(
      http.get(URL_PATTERN, () => HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 })),
    )

    const error = await apiRequest(PATH).catch((reason: unknown) => reason as ApiError)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'API request failed with status 404',
    })
  })
})
