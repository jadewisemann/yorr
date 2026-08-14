import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  MAX_LIMIT,
  type WeeklyRankingService,
  weeklyRankingResponse,
} from '../../game/ranking/index.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import type { UserIdentity, UserService } from '../../user/session.js'
import { sendCode } from '../errorResponse.js'

/**
 * 랭킹 조회 REST — backend-java `game/ranking/controller/RankingController`.
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
 * REST(2.9 `gameQueries.ts`)의 JSON `{code,message}`가 아니다 — Java에서
 * `ResponseEntity.body("session_expired")`가 `StringHttpMessageConverter`를 타
 * `text/plain`으로 나가고, 프론트 `shared/api/client.ts`가 JSON이 아닌 본문을
 * 텍스트로 읽어 코드로 매핑한다(`src/mocks/restHandlers.ts`가 같은 모양으로
 * 흉내내고 있다). 컨트롤러마다 오류 표면이 다른 것이 계약이므로 섞지 않는다.
 */
export interface RankingRouteDependencies {
  readonly users: UserService
  readonly rankings: WeeklyRankingService
}

/**
 * Java는 `@RequestParam(defaultValue = "100") int limit`이다 — 없으면 상한,
 * 숫자가 아니면 Spring의 타입 변환이 **400**을 만든다. 그 400의 본문은 Spring이
 * 만든 프레임워크 흔적이라 계약이 아니므로 **빈 본문**으로 맞춘다
 * (`gameQueries.ts`의 score-candidates 400과 같은 판단).
 *
 * 범위 클램프([1,100])는 여기서 하지 않는다 — 서비스가 한다. Java도 그렇고,
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

/**
 * 세션을 확인하고 **회원인지**까지 본다. 게스트 토큰은 401이 아니라 **403**이다 —
 * 인증은 됐지만 오를 자리 자체가 없는 상태라 다시 로그인해도 달라지지 않는다.
 *
 * `routes/users.ts`(4.3)에 같은 모양의 함수가 있다. 공통화하지 않은 것은 그 파일이
 * 다른 슬라이스의 것이고, 두 라우트가 우연히 같은 게이트를 쓸 뿐 같은 이유로
 * 움직이지 않기 때문이다 — 프로필은 "고칠 프로필이 없다", 랭킹은 "오를 자리가
 * 없다"다. 세 번째 사용처가 생기면 그때 `http/`로 올린다.
 *
 * 응답을 이미 보냈으면 `undefined`를 돌려준다.
 */
const authenticateMember = async (
  deps: RankingRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<UserIdentity | undefined> => {
  let identity: UserIdentity
  try {
    identity = await deps.users.authenticateSession(bearerToken(request))
  } catch (error) {
    if (!(error instanceof SessionAuthenticationError)) throw error
    sendCode(reply, 401, 'session_expired')
    return undefined
  }
  if (identity.type !== 'MEMBER') {
    sendCode(reply, 403, 'member_only')
    return undefined
  }
  return identity
}

/** 헤더가 없거나 형식이 다르면 `undefined` — `authenticateSession`이 401로 판정한다. */
const bearerToken = (request: FastifyRequest): string | undefined => {
  const header = request.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || !value.startsWith('Bearer ')) return undefined
  return value.slice('Bearer '.length)
}
