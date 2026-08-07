import { getResponse, HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerFirstHandler } from '@/mocks/serverFirstHandler'

const ENDPOINT = new URL('/api/v1/rooms', window.location.origin).href

/** fallback 뒤에 등록되는 mock handler 자리. 서버 응답을 못 쓸 때만 여기까지 온다. */
const mockFallback = http.all('/api/v1/rooms', async ({ request }) => {
  const body = request.method === 'POST' ? await request.json() : null
  return HttpResponse.json({ from: 'mock', echo: body })
})

let serverFetch: ReturnType<typeof vi.fn>

function serveFromRealServer(response: Response | Error) {
  serverFetch.mockImplementation(async () => {
    if (response instanceof Error) throw response
    return response
  })
}

async function resolve(request = new Request(ENDPOINT)) {
  const response = await getResponse([createServerFirstHandler(), mockFallback], request)
  if (!response) throw new Error('handler가 응답하지 않았습니다.')
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  serverFetch = vi.fn()
  vi.stubGlobal('fetch', serverFetch)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fallback 모드 catch-all', () => {
  it('실서버가 응답하면 mock을 건너뛰고 그대로 통과시킨다', async () => {
    serveFromRealServer(HttpResponse.json({ from: 'server' }))

    await expect(resolve()).resolves.toEqual({ status: 200, body: { from: 'server' } })
    expect(serverFetch).toHaveBeenCalledOnce()
  })

  it('실서버 요청에 bypass 표시를 붙여 자기 자신을 다시 가로채지 않는다', async () => {
    serveFromRealServer(HttpResponse.json({ from: 'server' }))

    await resolve()

    const [bypassed] = serverFetch.mock.calls[0] as [Request]
    expect(bypassed.headers.get('accept')).toContain('msw/passthrough')
  })

  it('도메인 에러는 구현된 endpoint의 정상 응답이므로 그대로 통과시킨다', async () => {
    serveFromRealServer(HttpResponse.json({ code: 'ROOM_NOT_FOUND' }, { status: 404 }))

    await expect(resolve()).resolves.toMatchObject({
      status: 404,
      body: { code: 'ROOM_NOT_FOUND' },
    })
  })

  it('snake_case 텍스트 도메인 코드도 서버 응답으로 인정한다', async () => {
    serveFromRealServer(HttpResponse.text('room_not_found', { status: 404 }))
    const response = await getResponse(
      [createServerFirstHandler(), mockFallback],
      new Request(ENDPOINT),
    )

    expect(response?.status).toBe(404)
    await expect(response?.text()).resolves.toBe('room_not_found')
  })

  it('매핑 없는 404(빈 본문)는 미구현으로 보고 mock에 넘긴다', async () => {
    serveFromRealServer(new HttpResponse(null, { status: 404 }))

    await expect(resolve()).resolves.toEqual({
      status: 200,
      body: { from: 'mock', echo: null },
    })
  })

  it('도메인 코드 없는 404 본문(HTML·JSON)도 미구현으로 본다', async () => {
    serveFromRealServer(HttpResponse.text('<html>Not Found</html>', { status: 404 }))
    await expect(resolve()).resolves.toMatchObject({ body: { from: 'mock' } })

    serveFromRealServer(HttpResponse.json({ error: 'not found' }, { status: 404 }))
    await expect(resolve()).resolves.toMatchObject({ body: { from: 'mock' } })
  })

  it('501은 미구현 선언으로 보고 mock에 넘긴다', async () => {
    serveFromRealServer(new HttpResponse(null, { status: 501 }))

    await expect(resolve()).resolves.toMatchObject({ body: { from: 'mock' } })
  })

  it('서버 연결 자체가 안 되면 mock으로 계속 개발할 수 있게 한다', async () => {
    serveFromRealServer(new TypeError('fetch failed'))

    await expect(resolve()).resolves.toMatchObject({ body: { from: 'mock' } })
  })

  it('본문 있는 요청도 mock handler가 다시 읽을 수 있게 clone해서 보낸다', async () => {
    serveFromRealServer(new HttpResponse(null, { status: 501 }))

    const result = await resolve(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: '호스트' }),
      }),
    )

    expect(result.body).toEqual({ from: 'mock', echo: { nickname: '호스트' } })
  })

  it('mock으로 넘길 때는 어떤 경로가 서버에 없는지 콘솔에 남긴다', async () => {
    serveFromRealServer(new HttpResponse(null, { status: 501 }))

    await resolve()

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('/api/v1/rooms'))
  })
})
