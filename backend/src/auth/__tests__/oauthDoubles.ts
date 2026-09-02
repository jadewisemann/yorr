import { SocialLoginError } from '../errors.js'
import type { FetchLike } from '../oauthHttp.js'

/** 대역이 받아 둔 호출 하나. 주소와 함께 본문·헤더까지 그대로 남긴다. */
export interface OAuthCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

/**
 * 미리 준비한 응답을 순서대로 돌려주는 fetch 대역. 큐가 비었는데 또 부르면
 * 던진다 — "몇 번 부르는가"도 계약이기 때문이다.
 */
export const stubFetch = (
  responses: Response[],
): { fetch: FetchLike; calls: OAuthCall[]; bodies: () => string[] } => {
  const calls: OAuthCall[] = []
  const queue = [...responses]
  return {
    calls,
    /** 지금까지 보낸 본문들. 호출이 끝난 뒤에 불러야 한다. */
    bodies: () => calls.map((call) => String(call.init?.body ?? '')),
    fetch: async (url, init) => {
      calls.push({ url, init })
      const next = queue.shift()
      if (next === undefined) throw new Error(`예상하지 않은 호출: ${url}`)
      return next
    },
  }
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 던져진 `SocialLoginError`의 사유. 던지지 않으면 그 자체가 실패다. */
export const reason = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    if (error instanceof SocialLoginError) return error.reason
    throw error
  }
  throw new Error('SocialLoginError가 던져지지 않았다')
}
