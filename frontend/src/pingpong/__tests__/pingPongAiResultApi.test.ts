import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { savePingPongAiResult } from '../pingPongAiResultApi'

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
})
