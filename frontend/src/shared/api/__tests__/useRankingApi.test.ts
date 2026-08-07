import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { useWeeklyRanking } from '../useRankingApi'

describe('useWeeklyRanking', () => {
  function countingHandler() {
    const calls = { count: 0 }
    mockApiServer.use(
      http.get('/api/v1/rankings/weekly', () => {
        calls.count += 1
        return HttpResponse.json({
          weekStart: '2026-08-03',
          entries: [{ rank: 1, userId: 'u1', nickname: `조회${calls.count}`, bestScore: 300 }],
        })
      }),
    )
    return calls
  }

  it('주기가 지나면 다시 읽는다', async () => {
    const calls = countingHandler()
    const { result } = renderHook(() => useWeeklyRanking({ intervalMs: 120 }))

    await waitFor(() => expect(calls.count).toBe(1))
    await waitFor(() => expect(calls.count).toBeGreaterThanOrEqual(2))

    expect(result.current.data?.entries).toHaveLength(1)
  })

  it('언마운트하면 더 묻지 않는다', async () => {
    const calls = countingHandler()
    const { result, unmount } = renderHook(() => useWeeklyRanking({ intervalMs: 60 }))

    await waitFor(() => expect(result.current.data).not.toBeNull())
    unmount()
    const afterUnmount = calls.count

    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(calls.count).toBe(afterUnmount)
  })
})
