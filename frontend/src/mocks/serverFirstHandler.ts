import { bypass, HttpResponse, http } from 'msw'

export function createServerFirstHandler() {
  return http.all('/api/*', async ({ request }) => {
    const serverResponse = await requestServer(request)
    if (serverResponse && !(await isEndpointMissing(serverResponse))) {
      return new HttpResponse(serverResponse.body, {
        status: serverResponse.status,
        statusText: serverResponse.statusText,
        headers: serverResponse.headers,
      })
    }

    console.warn(
      `[msw] ${request.method} ${new URL(request.url).pathname} — 서버에 없는 API 라 mock 으로 응답합니다.`,
    )
    return undefined
  })
}

async function requestServer(request: Request): Promise<Response | null> {
  try {
    return await fetch(bypass(request.clone()))
  } catch {
    return null
  }
}

async function isEndpointMissing(response: Response): Promise<boolean> {
  if (response.status === 501) return true
  if (response.status !== 404) return false

  const text = await response.clone().text()
  if (!text) return true

  try {
    const payload: unknown = JSON.parse(text)
    return !(typeof payload === 'object' && payload !== null && 'code' in payload)
  } catch {
    return !/^[a-z_]+$/.test(text.trim())
  }
}
