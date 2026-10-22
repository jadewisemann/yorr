import { HttpResponse, http } from 'msw'
import type { MockContext } from './types'

const MOCK_WEEK_START = '2026-08-03'

const mockWeeklyRanking = [
  { rank: 1, userId: 'mock-member-id', nickname: '카카오회원', bestScore: 312 },
  { rank: 2, userId: 'mock-rival-1', nickname: '주사위요정', bestScore: 288 },
  { rank: 2, userId: 'mock-rival-2', nickname: '한손잡이', bestScore: 288 },
  { rank: 4, userId: 'mock-rival-3', nickname: '엉뚱한선장', bestScore: 254 },
  { rank: 5, userId: 'mock-rival-4', nickname: '요트초보', bestScore: 231 },
  { rank: 6, userId: 'mock-rival-5', nickname: '굴림장인', bestScore: 205 },
]

/** 주간 랭킹 목록·내 순위. */
export const rankingHandlers = ({ beforeResponse, unavailable }: MockContext) => [
  http.get('/api/v1/rankings/weekly', async ({ request }) => {
    await beforeResponse()
    const failure = unavailable()
    if (failure) return failure
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? mockWeeklyRanking.length)
    return HttpResponse.json({
      weekStart: MOCK_WEEK_START,
      entries: mockWeeklyRanking.slice(0, Math.max(0, limit)),
    })
  }),
  http.get('/api/v1/rankings/weekly/me', async ({ request }) => {
    await beforeResponse()
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) {
      return HttpResponse.text('session_expired', { status: 401 })
    }
    const failure = unavailable()
    if (failure) return failure
    return HttpResponse.json({ weekStart: MOCK_WEEK_START, rank: 27, bestScore: 143 })
  }),
]
