import { useEffect } from 'react'
import { fetchMyWeeklyRank, fetchWeeklyRanking } from './rankingApi'
import { useFetchEffect } from './useAsyncTask'

const TICKER_LIMIT = 10

const REFRESH_INTERVAL_MS = 60_000

function useVisibleRefresh(refetch: () => void, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const refetchIfVisible = () => {
      if (document.visibilityState === 'visible') refetch()
    }

    const timer = window.setInterval(refetchIfVisible, intervalMs)
    document.addEventListener('visibilitychange', refetchIfVisible)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refetchIfVisible)
    }
  }, [enabled, intervalMs, refetch])
}

export function useWeeklyRanking({
  intervalMs = REFRESH_INTERVAL_MS,
  limit = TICKER_LIMIT,
}: {
  intervalMs?: number
  limit?: number
} = {}) {
  const query = useFetchEffect(`weekly-ranking:${limit}`, (signal) =>
    fetchWeeklyRanking({ limit, signal }),
  )

  useVisibleRefresh(query.refetch, intervalMs)

  return query
}

export function useMyWeeklyRank(
  sessionToken: string | null,
  { intervalMs = REFRESH_INTERVAL_MS }: { intervalMs?: number } = {},
) {
  const query = useFetchEffect(sessionToken ? `my-weekly-rank:${sessionToken}` : null, (signal) =>
    sessionToken ? fetchMyWeeklyRank(sessionToken, { signal }) : Promise.resolve(null),
  )

  useVisibleRefresh(query.refetch, intervalMs, sessionToken !== null)

  return query
}
