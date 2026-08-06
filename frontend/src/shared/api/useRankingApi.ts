import { useEffect } from 'react'
import { fetchMyWeeklyRank, fetchWeeklyRanking } from './rankingApi'
import { useFetchEffect } from './useAsyncTask'

/** 띠 하나에 흘려보낼 인원. 더 받아도 한 바퀴가 길어져 아무도 끝까지 보지 않는다. */
export const TICKER_LIMIT = 10

/**
 * 다시 읽는 주기. 한 판이 10~30분(12라운드 × 25초 × 인원)이므로 이보다 짧게 잡아도 새 값은
 * 없다. 반대로 더 길면 랜딩을 열어둔 사람이 방금 끝난 판을 놓친다.
 */
export const REFRESH_INTERVAL_MS = 60_000

/**
 * 주기마다, 그리고 탭으로 돌아올 때 다시 읽는다.
 * <p>
 * <b>보이지 않는 탭에서는 묻지 않는다.</b> 배경 탭이 하루 종일 열려 있는 것이 흔한 화면이라,
 * 아무도 보지 않는 값을 1분마다 받아오는 것은 서버와 배터리를 함께 쓰는 일이다. 대신 돌아오는
 * 순간 한 번 읽어 화면이 낡은 채로 보이지 않게 한다.
 */
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

/**
 * 상위 목록. 진입할 때 한 번, 이후 {@link REFRESH_INTERVAL_MS}마다 다시 읽는다.
 * <p>
 * 서버는 판이 끝날 때 집계 캐시를 비우므로(MatchArchiveService의 @CacheEvict) 이 주기가
 * 그대로 DB 부하가 되지는 않는다 — 대부분은 캐시에서 답한다.
 *
 * @param intervalMs 테스트가 짧은 주기를 넣을 수 있게 열어 둔다. fake timer로 60초를 건너뛰는
 *                   방법도 있지만, MSW는 실제 타이머로 응답하므로 둘을 섞으면 스위트 전체가
 *                   불안정해진다(실제로 그렇게 됐다)
 */
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

/**
 * 내 순위. 로그인하지 않았으면 아예 묻지 않는다 — 키가 null이면
 * {@link useFetchEffect}가 요청을 걸지 않고 상태를 비운다.
 * <p>
 * 상위 목록과 같은 주기로 갱신한다. 두 값이 다른 시점의 것이면 "목록엔 내가 4위인데 내 순위는
 * 7위"처럼 한 화면에서 어긋난 숫자가 보인다.
 */
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
