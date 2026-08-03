import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockApiServer } from '@/mocks/server'
import { useWeeklyRanking } from '../useRankingApi'

/**
 * 주기 갱신만 본다. <b>fake timer를 쓰지 않는다</b> — MSW는 실제 타이머로 응답하므로 둘을
 * 섞으면 이 파일뿐 아니라 스위트 전체가 불안정해진다. 대신 주기를 짧게 넣어 실제로 기다린다.
 */
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

  /**
   * 랜딩을 열어둔 채 다른 사람이 판을 끝내면 순위가 바뀐다. 주기 갱신이 조용히 죽으면 화면은
   * 멀쩡한데 값만 낡은 채로 남아 눈으로는 알 수 없다.
   */
  it('주기가 지나면 다시 읽는다', async () => {
    const calls = countingHandler()
    const { result } = renderHook(() => useWeeklyRanking({ intervalMs: 120 }))

    // 진입 시 1회. 몇 번째 응답인지로 단정하면 주기가 짧아 그 사이 몇 번이나 더 도는지에
    // 결과가 달라진다 — "다시 물었는가"만 본다.
    await waitFor(() => expect(calls.count).toBe(1))
    await waitFor(() => expect(calls.count).toBeGreaterThanOrEqual(2))

    expect(result.current.data?.entries).toHaveLength(1)
  })

  /** 언마운트 뒤에도 타이머가 돌면 아무도 보지 않는 값을 계속 받아온다. */
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
