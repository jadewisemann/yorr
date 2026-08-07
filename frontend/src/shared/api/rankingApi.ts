import { ApiError, apiRequest } from './client'

/** 한 줄. `rank`는 서버가 매긴다 — 동점은 같은 번호를 받고 다음 번호를 건너뛴다(1, 2, 2, 4). */
export interface WeeklyRankingEntry {
  rank: number
  userId: string
  nickname: string
  bestScore: number
}

export interface WeeklyRanking {
  /** 이 순위가 속한 주의 시작 날짜(KST 월요일). 화면의 "이번 주" 표기를 서버 기준으로 맞춘다. */
  weekStart: string
  entries: WeeklyRankingEntry[]
}

/**
 * 이번 주 최고점 랭킹. 회원만 집계된다 — 게스트는 계정이 없어 오를 자리가 없다.
 * <p>
 * 인증이 필요 없다. 오르는 것은 회원만이지만 보는 것은 누구나이고, 로그인하지 않은 사람에게
 * "로그인하면 여기 남는다"를 보여주는 자리이기도 하다.
 */
export function fetchWeeklyRanking(
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<WeeklyRanking> {
  const query = options.limit === undefined ? '' : `?limit=${options.limit}`
  return apiRequest<WeeklyRanking>(`/rankings/weekly${query}`, {
    signal: options.signal ?? null,
  })
}

/** 내 이번 주 순위. 상위 목록 밖에 있어도 자기 자리를 알 수 있어야 한다. */
export interface MyWeeklyRank {
  weekStart: string
  rank: number
  bestScore: number
}

/**
 * 내 순위를 읽는다. <b>없는 것과 못 읽는 것을 모두 {@code null}로 접는다</b> — 이 값은 화면의
 * 곁가지라, 이번 주에 한 판도 안 했든(204) 세션이 만료됐든(401) 게스트든(403) 화면이 할 일은
 * 같다: 내 순위 줄을 그리지 않는다.
 * <p>
 * 서버가 204를 주는 이유는 "0점 최하위"와 "기록 없음"을 구분하기 위함이고, 그 구분은 여기서
 * 흡수된다 — {@code apiRequest}가 204에 undefined를 돌려주므로 그대로 null로 바꾼다.
 */
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
