import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  calculateScoreCandidates,
  GameScoreQueryError,
  type GameScoreQueryReason,
  type GameScoreQueryService,
} from '../../game/query/index.js'
import { DICE_COUNT, type ScoreBoard } from '../../game/score/index.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import type { UserIdentity, UserService } from '../../user/session.js'

export interface GameQueryRouteDependencies {
  readonly users: UserService
  readonly queries: GameScoreQueryService
}

/**
 * 조회 REST의 오류 본문은 **JSON `{code,message}`** 다 — 방·봇 REST의 plain-text
 * 소문자 코드(`room_not_found` …)와 다르다. Java에서 컨트롤러마다 오류 표면이
 * 다른 것이 그대로 계약이므로 섞지 않는다(DESIGN.md 「오류 계약」).
 * 그래서 이 파일은 `http/errorResponse.ts`의 `sendCode`·`sendDomainError`를 쓰지 않는다.
 */
interface GameQueryErrorResponse {
  readonly code: string
  readonly message: string
}

/** Java `GameScoreQueryException.Reason` → (HTTP 상태, 응답 code). */
const ERROR_MAPPING: Readonly<Record<GameScoreQueryReason, readonly [number, string]>> = {
  ROOM_NOT_FOUND: [404, 'ROOM_NOT_FOUND'],
  PLAYER_NOT_IN_ROOM: [403, 'NOT_IN_ROOM'],
  GAME_NOT_STARTED: [409, 'GAME_NOT_STARTED'],
  GAME_NOT_FINISHED: [409, 'GAME_NOT_FINISHED'],
  STORE_FAILURE: [500, 'INTERNAL'],
}

const sendQueryError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (!(error instanceof GameScoreQueryError)) throw error
  const [status, code] = ERROR_MAPPING[error.reason]
  return reply.code(status).send({ code, message: error.message } satisfies GameQueryErrorResponse)
}

/** 헤더는 중복되면 배열로 온다 — 첫 값만 본다. */
const header = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** Java `ScoreBoardResponse`. 12키는 **생략하지 않고 `null`로** 싣는다. */
interface ScoreBoardResponse {
  readonly categories: Readonly<Record<string, number | null>>
  readonly upperSubtotal: number
  readonly upperBonus: number
  readonly total: number
}

const scoreBoardResponse = (scoreboard: ScoreBoard): ScoreBoardResponse => ({
  categories: scoreboard.categories,
  upperSubtotal: scoreboard.upperSubtotal,
  upperBonus: scoreboard.upperBonus,
  total: scoreboard.total,
})

/**
 * Java `ScoreCandidatesRequest`의 Bean Validation과 같은 범위:
 * 정확히 5개, 각각 1~6의 정수. 위반은 **400**이다.
 */
const scoreCandidatesRequestSchema = z.object({
  dice: z.array(z.number().int().min(1).max(6)).length(DICE_COUNT),
})

/**
 * 점수 조회 REST.
 *
 * `server.ts`가 `/api/v1` 프리픽스 안에서 등록한다. 라우트 등록만 export하고
 * 배선은 하지 않는다(다른 슬라이스와 같은 관용).
 */
export const registerGameQueryRoutes = async (
  app: FastifyInstance,
  deps: GameQueryRouteDependencies,
): Promise<void> => {
  const { users, queries } = deps

  /** 인증 실패는 401 + JSON `AUTH_FAILED`(방 REST의 `invalid_guest_session`이 아니다). */
  const authenticated = async (
    headers: Record<string, string | string[] | undefined>,
    reply: FastifyReply,
  ): Promise<UserIdentity | null> => {
    try {
      return await users.authenticate(
        header(headers, 'x-user-id'),
        header(headers, 'authorization'),
      )
    } catch (error) {
      if (!(error instanceof SessionAuthenticationError)) throw error
      reply.code(401).send({
        code: 'AUTH_FAILED',
        message: '유효하지 않은 사용자 세션입니다.',
      } satisfies GameQueryErrorResponse)
      return null
    }
  }

  app.get<{ Params: { roomId: string } }>('/rooms/:roomId/scores', async (request, reply) => {
    const requester = await authenticated(request.headers, reply)
    if (!requester) return reply
    try {
      const scoreboards = await queries.getScoreboards(request.params.roomId, requester.userId)
      // playerId 오름차순(스토어가 정한 순서)을 그대로 객체 키 순서로 옮긴다.
      const response: Record<string, ScoreBoardResponse> = {}
      for (const [playerId, scoreboard] of scoreboards) {
        response[playerId] = scoreBoardResponse(scoreboard)
      }
      return reply.send(response)
    } catch (error) {
      return sendQueryError(reply, error)
    }
  })

  app.get<{ Params: { roomId: string } }>('/rooms/:roomId/results', async (request, reply) => {
    const requester = await authenticated(request.headers, reply)
    if (!requester) return reply
    try {
      const result = await queries.getResults(request.params.roomId, requester.userId)
      return reply.send({
        // Java `GameRankingResponse`는 점수 필드 이름이 `total`이다(`finalScore` 아님).
        rankings: result.players.map((player) => ({
          rank: player.rank,
          playerId: player.playerId,
          total: player.finalScore,
        })),
        isTie: result.isTie,
      })
    } catch (error) {
      return sendQueryError(reply, error)
    }
  })

  /**
   * **인증 없음 · `gameId` 미사용**의 순수 계산기(Java와 같은 quirk).
   *
   * 본문 검증 실패를 "400 + 빈 본문"으로 맞추려고 캡슐화된 하위 스코프에
   * 오류 핸들러를 둔다 — 이 스코프 밖(방 REST 등)에는 영향이 없다. JSON 파싱
   * 실패·미지원 Content-Type처럼 Fastify가 스스로 만드는 4xx도 같은 모양으로
   * 나가야 프레임워크 흔적(`{statusCode,error,message}`)이 계약처럼 굳지 않는다.
   */
  await app.register(async (scope) => {
    scope.setErrorHandler((error: FastifyError, _request, reply) => {
      const status = error.statusCode ?? 500
      if (status < 500) return reply.code(status).send()
      return reply.send(error)
    })

    scope.post<{ Params: { gameId: string }; Body: unknown }>(
      '/games/:gameId/score-candidates',
      async (request, reply) => {
        const parsed = scoreCandidatesRequestSchema.safeParse(request.body)
        if (!parsed.success) return reply.code(400).send()
        return reply.send({ candidates: calculateScoreCandidates(parsed.data.dice) })
      },
    )
  })
}
