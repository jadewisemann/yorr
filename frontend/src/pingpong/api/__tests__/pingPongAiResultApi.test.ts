import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { savePingPongAiResult } from '@/pingpong/api/pingPongAiResultApi'

describe('savePingPongAiResult', () => {
  it('로그인 토큰과 사람·AI 최종 점수를 전송한다', async () => {
    let authorization: string | null = null
    let body: unknown
    mockApiServer.use(
      http.post('/api/v1/games/ping-pong/ai-results', async ({ request }) => {
        authorization = request.headers.get('Authorization')
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await savePingPongAiResult('member-token', {
      resultId: '4b72f136-f3c2-49c9-bfdb-290891fd8638',
      humanScore: 11,
      aiScore: 7,
    })

    expect(authorization).toBe('Bearer member-token')
    expect(body).toEqual({
      resultId: '4b72f136-f3c2-49c9-bfdb-290891fd8638',
      humanScore: 11,
      aiScore: 7,
    })
  })

  it('게스트 결과는 인증 헤더 없이 전송한다', async () => {
    let authorization: string | null = 'not-called'
    mockApiServer.use(
      http.post('/api/v1/games/ping-pong/ai-results', ({ request }) => {
        authorization = request.headers.get('Authorization')
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await savePingPongAiResult(null, {
      resultId: 'f6136597-b2ac-4d12-9d52-174cb3f45f45',
      humanScore: 6,
      aiScore: 11,
    })

    expect(authorization).toBeNull()
  })
})
