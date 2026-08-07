import { ApiError, apiRequest } from './client'

export interface WeeklyRankingEntry {
  rank: number
  userId: string
  nickname: string
  bestScore: number
}

export interface WeeklyRanking {
  weekStart: string
  entries: WeeklyRankingEntry[]
}

export function fetchWeeklyRanking(
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<WeeklyRanking> {
  const query = options.limit === undefined ? '' : `?limit=${options.limit}`
  return apiRequest<WeeklyRanking>(`/rankings/weekly${query}`, {
    signal: options.signal ?? null,
  })
}

export interface MyWeeklyRank {
  weekStart: string
  rank: number
  bestScore: number
}

export async function fetchMyWeeklyRank(
  sessionToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<MyWeeklyRank | null> {
  try {
    const rank = await apiRequest<MyWeeklyRank | undefined>('/rankings/weekly/me', {
      headers: { Authorization: `Bearer ${sessionToken}` },
      signal: options.signal ?? null,
    })
    return rank ?? null
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null
    throw error
  }
}
