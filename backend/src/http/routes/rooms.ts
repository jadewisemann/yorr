import type { FastifyInstance, FastifyReply } from 'fastify'
import { ConflictError, DomainError } from '../../errors.js'
import type { GameCatalog } from '../../game/catalog.js'
import type { GameLifecycleService } from '../../game/lifecycle.js'
import type { BotParticipantService } from '../../room/botService.js'
import { ForbiddenError } from '../../room/botService.js'
import type { RoomService } from '../../room/roomService.js'
import type { RoomMode, RoomSnapshot } from '../../room/snapshot.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import { normalizeNickname, type UserIdentity, type UserService } from '../../user/session.js'
import type { RoomBroadcaster } from '../../ws/broadcaster.js'
import { envelope } from '../../ws/envelope.js'
import type { RealtimeRoomSnapshotService } from '../../ws/snapshot.js'
import { sendCode, sendDomainError } from '../errorResponse.js'
import { header } from '../memberAuth.js'

/** 대시보드 표시 이름. 참가자 목록에 오르지 않으므로 화면에 나오지 않는다(로그·관리용). */
const DASHBOARD_NICKNAME = '대시보드'

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

interface EnterRoomBody {
  readonly nickname?: string
  readonly room_id?: string
  readonly session_token?: string
}

/** 이 API만 snake_case다 — 프론트 `EnterRoomResponse`와 1:1. */
interface EnterRoomResponse {
  readonly id: string
  readonly nickname: string
  readonly token: string
  readonly room_id: string
  readonly game_code: string | null
}

interface Entrant {
  readonly identity: UserIdentity
  readonly sessionToken: string
}

const isBlank = (value: string | undefined | null): boolean => (value ?? '').trim().length === 0

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

export const registerRoomRoutes = async (
  app: FastifyInstance,
  deps: RoomRouteDependencies,
): Promise<void> => {
  const { users, rooms, catalog, lifecycle } = deps

  /**
   * 방에 들어갈 정체성을 정한다. 로그인 세션이 살아 있으면 그 회원으로, 아니면 새 게스트로.
   *
   * 토큰이 만료됐다고 입장 자체를 막지는 않는다 — 로그인 화면으로 돌려보내는 것보다
   * 게스트로라도 놀게 하는 편이 낫다. 방에서 쓸 이름은 이번 입장에 적어 낸 값이 우선이다.
   */
  const resolveEntrant = async (body: EnterRoomBody): Promise<Entrant> => {
    const token = body.session_token
    if (!isBlank(token)) {
      try {
        const member = await users.authenticateSession(token)
        const nickname = isBlank(body.nickname) ? member.nickname : normalizeNickname(body.nickname)
        return { identity: { ...member, nickname }, sessionToken: token as string }
      } catch (error) {
        if (!(error instanceof SessionAuthenticationError)) throw error
        app.log.info('만료된 세션으로 입장 시도 — 게스트로 진행합니다')
      }
    }
    const guest = await users.createGuest(body.nickname)
    return {
      identity: { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' },
      sessionToken: guest.sessionToken,
    }
  }

  const joinExisting = async (entrant: Entrant, roomId: string): Promise<EnterRoomResponse> => {
    const snapshot = await rooms.join(roomId, entrant.identity)
    await users.assignRoom(entrant.identity.userId, roomId, roomId, snapshot.hostId ?? '')
    return response(entrant, roomId, snapshot.gameCode)
  }

  /** `room_id`가 없으면 생성, 있으면 참가 — 게스트 발급까지 이 API 하나에 통합돼 있다. */
  const enterRoom = async (
    body: EnterRoomBody,
    requestedGameCode: string,
    party: boolean,
  ): Promise<EnterRoomResponse> => {
    // 참가일 때는 game_code를 검증하지 않는다 — 방에 적힌 값이 곧 게임이다.
    const game = isBlank(body.room_id) ? catalog.require(requestedGameCode) : null
    // 대시보드는 플레이어가 아니라 이름을 짓지 않는다 — 닉네임 화면을 건너뛰고 들어온다.
    const dashboard = game !== null && party
    const entrant = await resolveEntrant(
      dashboard && isBlank(body.nickname) ? { ...body, nickname: DASHBOARD_NICKNAME } : body,
    )
    if (game === null) return joinExisting(entrant, body.room_id as string)

    const mode: RoomMode = party ? 'PARTY' : 'NORMAL'
    // 정원은 게임이 정한다. 파티 방에서도 그대로 쓴다 — 대시보드는 명단에 들어가지
    // 않으므로 이 수만큼의 컨트롤러가 온전히 들어올 수 있다.
    const roomId = await rooms.createRoom(game.maxPlayers, entrant.identity.userId, game.code, mode)
    if (!dashboard) return joinExisting(entrant, roomId)

    // 파티 방을 연 화면은 대시보드다 — 명단에 넣지 않는다. 방장도 대시보드가 아니라
    // 처음 들어온 컨트롤러가 된다(JOIN Lua가 넘겨준다).
    await users.assignRoom(entrant.identity.userId, roomId, roomId, '')
    return response(entrant, roomId, game.code)
  }

  app.post<{ Body: EnterRoomBody; Querystring: { game_code?: string; party?: string } }>(
    '/rooms',
    async (request, reply) => {
      try {
        const entered = await enterRoom(
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
      const { roomCode } = request.params
      const snapshot = await rooms.getSnapshot(roomCode)
      if (!(await rooms.leave(roomCode, user.userId))) return roomNotFound(reply)
      await users.clearRoom(user.userId)
      // 게임 중 명시적 퇴장: 뒤따르는 소켓 close는 끊김과 구분되지 않으므로 여기서
      // WS 명단·턴 순서까지 정리해야 "나가도 오프라인으로 방에 남는" 문제가 없다.
      if (snapshot.phase === 'PLAYING') {
        await lifecycle.removePlayer(roomCode, snapshot.gameCode, user.userId)
      }
      return reply.code(204).send()
    },
  )

  app.post<{ Params: { roomCode: string } }>('/rooms/:roomCode/games', async (request, reply) => {
    const { roomCode } = request.params
    const snapshot = await hostOnly(request.headers, roomCode, reply)
    if (!snapshot) return reply
    try {
      return reply.send(await lifecycle.start(roomCode))
    } catch (error) {
      return sendConflictOnly(reply, error)
    }
  })

  /**
   * 끝난 게임을 대기실로 되돌린다. 방 전체가 한 번에 옮겨간다 — 화면 전환이
   * phase(스냅샷) 기준이라 한 명만 대기실로 보낼 수 없다.
   */
  app.post<{ Params: { roomCode: string } }>('/rooms/:roomCode/lobby', async (request, reply) => {
    const { roomCode } = request.params
    const snapshot = await hostOnly(request.headers, roomCode, reply)
    if (!snapshot) return reply
    if (!(await lifecycle.returnToLobby(roomCode, snapshot))) {
      return sendCode(reply, 409, 'not_finished')
    }
    return reply.code(204).send()
  })

  await registerBotRoutes(app, deps, authenticated)

  /** 인증 실패는 401 + 본문 `invalid_guest_session`(방·봇 API의 문자열). */
  /**
   * 호스트만 할 수 있는 방 조작의 앞단. 통과하면 방 스냅샷을, 막히면 `null`을
   * 돌려주며 **응답은 이미 보낸 상태다**(401·404·403 가운데 하나).
   */
  async function hostOnly(
    headers: Record<string, string | string[] | undefined>,
    roomCode: string,
    reply: FastifyReply,
  ): Promise<RoomSnapshot | null> {
    const user = await authenticated(headers, reply)
    if (!user) return null
    const snapshot = await rooms.getSnapshot(roomCode)
    if (snapshot.phase === null) {
      roomNotFound(reply)
      return null
    }
    if (!isHost(snapshot, user.userId)) {
      sendCode(reply, 403, 'host_only')
      return null
    }
    return snapshot
  }

  async function authenticated(
    headers: Record<string, string | string[] | undefined>,
    reply: FastifyReply,
  ): Promise<UserIdentity | null> {
    try {
      return await users.authenticate(
        header(headers, 'x-user-id'),
        header(headers, 'authorization'),
      )
    } catch (error) {
      if (!(error instanceof SessionAuthenticationError)) throw error
      sendCode(reply, 401, error.code)
      return null
    }
  }
}

type Authenticator = (
  headers: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
) => Promise<UserIdentity | null>

/**
 * 대기실 봇 API.
 *
 * 응답은 방 REST 스냅샷이고, 성공 시 방 전원에게 `state.sync`를 쏜다(변경한
 * 사람만 스냅샷을 받으면 다른 화면의 명단이 어긋난다).
 *
 * 의존성이 없으면 라우트를 등록하지 않는다 — 프로세스 조립(server.ts)이 봇
 * 서비스와 WS 인스턴스를 넘겨줘야 살아난다.
 */
const registerBotRoutes = async (
  app: FastifyInstance,
  deps: RoomRouteDependencies,
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

/**
 * 봇 API의 오류 매핑 — **방 API와 다르다**. 여기서는 `room_not_found`만 404이고
 * 나머지 `DomainError`는 400(`invalid_game_code`), `bot_not_found`만 409가 아닌
 * 404다. 라우트별로 다른 이 비일관성이 그대로 계약이다(DESIGN.md 「오류 계약」).
 */
const sendBotError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof ForbiddenError) return sendCode(reply, 403, error.code)
  if (error instanceof DomainError) {
    return sendCode(reply, error.code === 'room_not_found' ? 404 : 400, error.code)
  }
  if (error instanceof ConflictError) {
    return sendCode(reply, error.code === 'bot_not_found' ? 404 : 409, error.code)
  }
  throw error
}

/** 시작 실패만 409로 내린다 — 그 외(모르는 게임 코드 등)는 500으로 나간다. */
const sendConflictOnly = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof ConflictError) return sendCode(reply, 409, error.code)
  throw error
}

const response = (
  entrant: Entrant,
  roomId: string,
  gameCode: string | null,
): EnterRoomResponse => ({
  id: entrant.identity.userId,
  nickname: entrant.identity.nickname,
  token: entrant.sessionToken,
  room_id: roomId,
  game_code: gameCode,
})
