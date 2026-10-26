import { HttpResponse, http } from 'msw'
import type { MockContext } from './types'

/** 로그인·세션 확인·로그아웃. */
export const authHandlers = ({ beforeResponse }: MockContext) => [
  http.post('/api/v1/auth/session', async ({ request }) => {
    await beforeResponse()
    const body = (await request.json()) as { code?: string }
    if (!body.code) return HttpResponse.text('invalid_login_code', { status: 401 })
    return HttpResponse.json({
      userId: 'mock-member-id',
      nickname: '카카오회원',
      type: 'MEMBER',
      sessionToken: 'mock-member-token',
    })
  }),
  http.get('/api/v1/auth/me', async ({ request }) => {
    await beforeResponse()
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) {
      return HttpResponse.text('session_expired', { status: 401 })
    }
    return HttpResponse.json({
      userId: 'mock-member-id',
      nickname: '카카오회원',
      type: 'MEMBER',
      sessionToken: null,
    })
  }),
  http.delete('/api/v1/auth/session', async () => {
    await beforeResponse()
    return new HttpResponse(null, { status: 204 })
  }),
]
