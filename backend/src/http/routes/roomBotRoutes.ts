import type { FastifyInstance, FastifyReply } from 'fastify'
import type { GameCatalog } from '../../game/catalog.js'
import type { BotParticipantService } from '../../room/botService.js'
import type { RoomSnapshot } from '../../room/snapshot.js'
import type { UserIdentity } from '../../user/session.js'
import type { RoomBroadcaster } from '../../ws/broadcaster.js'
import { envelope } from '../../ws/envelope.js'
import type { RealtimeRoomSnapshotService } from '../../ws/snapshot.js'
import { sendCode } from '../errorResponse.js'
import { sendBotError } from './roomRouteErrors.js'

export type Authenticator = (
  headers: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
) => Promise<UserIdentity | null>

export interface BotRouteDependencies {
  readonly catalog: GameCatalog
  readonly bots?: BotParticipantService
  readonly broadcaster?: RoomBroadcaster
  readonly snapshots?: RealtimeRoomSnapshotService
}

/**
 * 대기실 봇 API.
 *
 * 응답은 방 REST 스냅샷이고, 성공 시 방 전원에게 `state.sync`를 쏜다(변경한
 * 사람만 스냅샷을 받으면 다른 화면의 명단이 어긋난다).
 *
 * 의존성이 없으면 라우트를 등록하지 않는다 — 프로세스 조립(server.ts)이 봇
 * 서비스와 WS 인스턴스를 넘겨줘야 살아난다.
 */
export const registerBotRoutes = async (
  app: FastifyInstance,
  deps: BotRouteDependencies,
  authenticated: Authenticator,
): Promise<void> => {
  const { bots, broadcaster, snapshots, catalog } = deps
  if (!bots || !broadcaster || !snapshots) {
    app.log.warn('봇 의존성이 없어 /rooms/{code}/bots 라우트를 등록하지 않았습니다')
    return
  }

  const mutate = async (
    roomCode: string,
    request: { headers: Record<string, string | string[] | undefined> },
    reply: FastifyReply,
    operation: (requester: UserIdentity) => Promise<RoomSnapshot>,
  ): Promise<FastifyReply> => {
    const requester = await authenticated(request.headers, reply)
    if (!requester) return reply
    try {
      // 게임 조회가 방 존재 확인보다 **먼저**다 — 없는 방에 봇을 붙이면 404가 아니라
      // 400 `invalid_game_code`가 나가는 quirk가 여기서 나온다(계약 동결).
      const gameCode = (await snapshots.snapshot(roomCode)).gameCode
      if (!catalog.require(gameCode).supportsBots) {
        return sendCode(reply, 409, 'bots_not_supported')
      }
      const snapshot = await operation(requester)
      broadcaster.broadcast(
        roomCode,
        envelope(
          'state.sync',
          { snapshot: await snapshots.snapshot(roomCode) },
          { roomId: roomCode },
        ),
      )
      return reply.send(snapshot)
    } catch (error) {
      return sendBotError(reply, error)
    }
  }

  app.post<{ Params: { roomCode: string } }>('/rooms/:roomCode/bots', async (request, reply) => {
    const { roomCode } = request.params
    return mutate(roomCode, request, reply, (requester) => bots.add(roomCode, requester.userId))
  })

  app.delete<{ Params: { roomCode: string; botId: string } }>(
    '/rooms/:roomCode/bots/:botId',
    async (request, reply) => {
      const { roomCode, botId } = request.params
      return mutate(roomCode, request, reply, (requester) =>
        bots.remove(roomCode, requester.userId, botId),
      )
    },
  )
}
