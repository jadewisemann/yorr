import { bypass, HttpResponse, http } from 'msw'

/**
 * fallback 모드 전용 catch-all handler.
 * 모든 /api 요청을 실서버로 먼저 보내고, endpoint 가 서버에 아직 없을 때만
 * 아무것도 반환하지 않아 뒤에 등록된 mock handler 로 넘긴다.
 */
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
    // clone: mock 으로 넘어갈 때 handler 가 body 를 다시 읽을 수 있어야 한다.
    return await fetch(bypass(request.clone()))
  } catch {
    // 서버 연결 자체가 안 되면(로컬 backend 미기동 등) mock 으로 넘긴다.
    return null
  }
}

/**
 * 404 라도 도메인 에러(room_not_found, {code: ...})면 구현된 endpoint 의 정상 응답이다.
 * 매핑 없는 경로에 서버가 주는 기본 404(body 에 도메인 코드 없음)만 "endpoint 없음"으로 본다.
 */
async function isEndpointMissing(response: Response): Promise<boolean> {
  if (response.status === 501) return true
  if (response.status !== 404) return false

  const text = await response.clone().text()
  if (!text) return true

  try {
    const payload: unknown = JSON.parse(text)
    return !(typeof payload === 'object' && payload !== null && 'code' in payload)
  } catch {
    // 실서버 도메인 에러는 'room_not_found' 같은 snake_case 텍스트로도 온다.
    return !/^[a-z_]+$/.test(text.trim())
  }
}
