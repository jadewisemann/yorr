import type { FastifyInstance, FastifyReply } from 'fastify'
import { ConflictError } from '../../errors.js'
import type { GameCatalog } from '../../game/catalog.js'
import type { GameLifecycleService } from '../../game/lifecycle.js'
import type { BotParticipantService } from '../../room/botService.js'
import type { RoomService } from '../../room/roomService.js'
import type { RoomSnapshot } from '../../room/snapshot.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import type { UserIdentity, UserService } from '../../user/session.js'
import type { RoomBroadcaster } from '../../ws/broadcaster.js'
import type { RealtimeRoomSnapshotService } from '../../ws/snapshot.js'
import { sendCode, sendDomainError } from '../errorResponse.js'
import { header } from '../headers.js'
import { registerBotRoutes } from './roomBotRoutes.js'
import { createRoomEntry, type EnterRoomBody } from './roomEntry.js'
import { sendConflictOnly } from './roomRouteErrors.js'

export interface RoomRouteDependencies {
  readonly users: UserService
  readonly rooms: RoomService
  readonly catalog: GameCatalog
  readonly lifecycle: GameLifecycleService
  /**
   * 봇 API(`/rooms/{code}/bots`)는 이 셋이 **모두** 있어야 등록된다 — 변경 결과를
   * 방 전원에게 알리려면 WS 게이트웨이가 쓰는 것과 **같은 인스턴스**의
   * 브로드캐스터·스냅샷 서비스여야 하기 때문이다(새로 만들면 방송이 허공으로 간다).
   */
  readonly bots?: BotParticipantService
  readonly broadcaster?: RoomBroadcaster
  readonly snapshots?: RealtimeRoomSnapshotService
}

/**
 * 이 사람이 방을 조작할 수 있는 호스트인가.
 *
 * hostId 일치 + **플레이어 명단에도 있을 것**을 함께 본다 — 방을 떠난 옛 host가
 * 토큰만 들고 남의 게임을 시작하는 것을 막는 조건이다.
 */
const isHost = (snapshot: RoomSnapshot, userId: string): boolean =>
  snapshot.hostId === userId && snapshot.players.some((player) => player.playerId === userId)

/**
 * 방이 없을 때의 404. 본문에 도메인 코드를 실어야 클라이언트가 "방이 종료됐다"로
 * 안내한다 — 빈 본문이면 사용자에게 "API request failed with status 404"가 노출된다.
 */
const roomNotFound = (reply: FastifyReply): FastifyReply => sendCode(reply, 404, 'room_not_found')

type Authenticated = (
  headers: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
) => Promise<UserIdentity | null>

/**
 * 호스트만 부를 수 있는 방 전이 — 시작과 대기실 복귀가 같은 검증 순서를 쓴다.
 * 방이 없으면 404, 호스트가 아니면 403. `action`이 던지면 `onError`가 옮긴다.
 */
const hostTransition = (
  deps: RoomRouteDependencies & {
    readonly authenticated: Authenticated
  },

  action: (roomCode: string, snapshot: RoomSnapshot) => Promise<unknown>,
  onError: (reply: FastifyReply, error: unknown) => FastifyReply,
) => {
  return async (
    request: {
      headers: Record<string, string | string[] | undefined>
      params: { roomCode: string }
    },
    reply: FastifyReply,
  ): Promise<unknown> => {
    const user = await deps.authenticated(request.headers, reply)
    if (!user) return reply
    const { roomCode } = request.params
    const snapshot = await deps.rooms.getSnapshot(roomCode)
    if (snapshot.phase === null) return roomNotFound(reply)
    if (!isHost(snapshot, user.userId)) return sendCode(reply, 403, 'host_only')
    try {
      const result = await action(roomCode, snapshot)
      return result === undefined ? reply.code(204).send() : reply.send(result)
    } catch (error) {
      return onError(reply, error)
    }
  }
}

/** 게임 중 명시적 퇴장 — REST로 나가는 경로. */
const leaveRoom = async (
  deps: Pick<RoomRouteDependencies, 'users' | 'rooms' | 'lifecycle'>,
  { roomCode, userId }: { readonly roomCode: string; readonly userId: string },
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const snapshot = await deps.rooms.getSnapshot(roomCode)
  if (!(await deps.rooms.leave(roomCode, userId))) return roomNotFound(reply)
  await deps.users.clearRoom(userId)
  if (snapshot.phase === 'PLAYING') {
    await deps.lifecycle.removePlayer(roomCode, snapshot.gameCode, userId)
  }
  return reply.code(204).send()
}

/** 인증 실패는 401 + 본문 `invalid_guest_session`(방·봇 API의 문자열). */
const authenticateGuest = async (
  users: UserService,
  headers: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
): Promise<UserIdentity | null> => {
  try {
    return await users.authenticate(header(headers, 'x-user-id'), header(headers, 'authorization'))
  } catch (error) {
    if (!(error instanceof SessionAuthenticationError)) throw error
    sendCode(reply, 401, error.code)
    return null
  }
}

export const registerRoomRoutes = async (
  app: FastifyInstance,
  deps: RoomRouteDependencies,
): Promise<void> => {
  const { users, rooms, catalog, lifecycle } = deps
  const authenticated = (
    headers: Record<string, string | string[] | undefined>,
    reply: FastifyReply,
  ) => authenticateGuest(users, headers, reply)
  const entry = createRoomEntry({ users, rooms, catalog, log: app.log })

  app.post<{ Body: EnterRoomBody; Querystring: { game_code?: string; party?: string } }>(
    '/rooms',
    async (request, reply) => {
      try {
        const entered = await entry.enterRoom(
          request.body ?? {},
          request.query.game_code ?? 'YACHT_DICE',
          request.query.party === 'true',
        )
        return reply.send(entered)
      } catch (error) {
        return sendDomainError(reply, error)
      }
    },
  )

  app.delete<{ Params: { roomCode: string } }>(
    '/rooms/:roomCode/players/me',
    async (request, reply) => {
      const user = await authenticated(request.headers, reply)
      if (!user) return reply
      return leaveRoom(
        { users, rooms, lifecycle },
        { roomCode: request.params.roomCode, userId: user.userId },
        reply,
      )
    },
  )

  app.post<{ Params: { roomCode: string } }>(
    '/rooms/:roomCode/games',
    hostTransition(
      { ...deps, authenticated },
      (roomCode) => lifecycle.start(roomCode),
      sendConflictOnly,
    ),
  )

  /**
   * 끝난 게임을 대기실로 되돌린다. 방 전체가 한 번에 옮겨간다 — 화면 전환이
   * phase(스냅샷) 기준이라 한 명만 대기실로 보낼 수 없다.
   */
  app.post<{ Params: { roomCode: string } }>(
    '/rooms/:roomCode/lobby',
    hostTransition(
      { ...deps, authenticated },
      async (roomCode, snapshot) => {
        if (await lifecycle.returnToLobby(roomCode, snapshot)) return undefined
        throw new ConflictError('not_finished')
      },
      (reply, error) =>
        error instanceof ConflictError
          ? sendCode(reply, 409, error.code)
          : sendConflictOnly(reply, error),
    ),
  )

  await registerBotRoutes(app, deps, authenticated)
}
