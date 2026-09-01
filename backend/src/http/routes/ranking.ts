import type { FastifyInstance } from 'fastify'
import {
  MAX_LIMIT,
  type WeeklyRankingService,
  weeklyRankingResponse,
} from '../../game/ranking/index.js'
import type { UserService } from '../../user/session.js'
import { authenticateMember } from '../memberAuth.js'

/**
 * 랭킹 조회 REST.
 *
 * | 요청 | 응답 |
 * |---|---|
 * | `GET /rankings/weekly?limit=50` | **무인증** 200 `{weekStart, entries:[{rank,userId,nickname,bestScore}]}` |
 * | `GET /rankings/weekly/me` (Bearer) | 200 `{weekStart, rank, bestScore}` · **204**(이번 주 무기록) · 401 `session_expired` · 403 `member_only` |
 *
 * **상위 목록은 인증을 요구하지 않는다.** 순위에 오르는 것은 회원만이지만 보는
 * 것은 누구나다 — 로그인해야 볼 수 있게 하면 "로그인하면 무엇이 남는가"를 보여줄
 * 자리가 사라진다. 프론트의 랭킹 티커도 비로그인 상태에서 이 목록을 읽는다
 * (`frontend/src/landing/components/RankingTicker.tsx`).
 *
 * 오류 본문은 **plain-text 소문자 코드**다(프로필·auth REST와 같은 결). 조회
 * REST(`gameQueries.ts`)의 JSON `{code,message}`가 아니다 — 본문이
 * `text/plain`으로 나가고, 프론트 `shared/api/client.ts`가 JSON이 아닌 본문을
 * 텍스트로 읽어 코드로 매핑한다(`src/mocks/restHandlers.ts`가 같은 모양으로
 * 흉내내고 있다). 라우트마다 오류 표면이 다른 것이 계약이므로 섞지 않는다.
 */
export interface RankingRouteDependencies {
  readonly users: UserService
  readonly rankings: WeeklyRankingService
}

/**
 * `limit`은 없으면 상한, 숫자가 아니면 **400**이다. 그 400의 본문은 프레임워크
 * 흔적이라 계약이 아니므로 **빈 본문**으로 맞춘다(`gameQueries.ts`의
 * score-candidates 400과 같은 판단).
 *
 * 범위 클램프([1,100])는 여기서 하지 않는다 — 서비스가 한다.
 * `limit=0`·`limit=1000`은 오류가 아니라 잘리는 값이다.
 *
 * @returns 정수면 그 값, `undefined`면 400을 보내야 한다
 */
const parseLimit = (raw: unknown): number | undefined => {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === null || value === '') return MAX_LIMIT
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim())) return undefined
  return Number(value)
}

export const registerRankingRoutes = async (
  app: FastifyInstance,
  deps: RankingRouteDependencies,
): Promise<void> => {
  app.get<{ Querystring: { limit?: string } }>('/rankings/weekly', async (request, reply) => {
    const limit = parseLimit(request.query.limit)
    if (limit === undefined) return reply.code(400).send()
    return reply.code(200).send(weeklyRankingResponse(await deps.rankings.currentWeek(limit)))
  })

  app.get('/rankings/weekly/me', async (request, reply) => {
    const member = await authenticateMember(deps, request, reply)
    if (member === undefined) return reply
    const rank = await deps.rankings.myCurrentWeek(member.userId)
    // 빈 값을 200으로 돌려주면 "0점으로 최하위"와 "아직 한 판도 안 했다"를
    // 클라이언트가 구분할 수 없다. 프론트는 204를 `null`로 읽는다
    // (`rankingApi.ts`의 `fetchMyWeeklyRank`).
    if (rank === undefined) return reply.code(204).send()
    return reply.code(200).send(rank)
  })
}
