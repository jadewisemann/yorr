import type { FastifyBaseLogger } from 'fastify'
import type { GameCatalog } from '../../game/catalog.js'
import type { RoomService } from '../../room/roomService.js'
import type { RoomMode } from '../../room/snapshot.js'
import { SessionAuthenticationError } from '../../user/errors.js'
import { normalizeNickname, type UserIdentity, type UserService } from '../../user/session.js'

/**
 * 방 입장의 정체성 결정과 생성/참가 — `rooms.ts`의 라우트에서 떼어낸 순수 배선.
 *
 * 왜 분리했나: 이 흐름(세션 확인 → 게스트 발급 → 방 생성 또는 참가 → 대시보드 예외)이
 * 라우트 등록 함수 안에 있으면 라우트 하나를 읽는 데 입장 규칙 전체를 통과해야 한다.
 * 여기서는 **HTTP를 모른다** — 상태 코드·응답 봉투는 호출자(`rooms.ts`)가 고른다.
 */

/** 대시보드 표시 이름. 참가자 목록에 오르지 않으므로 화면에 나오지 않는다(로그·관리용). */
export const DASHBOARD_NICKNAME = '대시보드'

export interface EnterRoomBody {
  readonly nickname?: string
  readonly room_id?: string
  readonly session_token?: string
}

/** 이 API만 snake_case다 — 프론트 `EnterRoomResponse`와 1:1. */
export interface EnterRoomResponse {
  readonly id: string
  readonly nickname: string
  readonly token: string
  readonly room_id: string
  readonly game_code: string | null
}

export interface Entrant {
  readonly identity: UserIdentity
  readonly sessionToken: string
}

export interface RoomEntryDependencies {
  readonly users: UserService
  readonly rooms: RoomService
  readonly catalog: GameCatalog
  readonly log: Pick<FastifyBaseLogger, 'info'>
}

const isBlank = (value: string | undefined | null): boolean => (value ?? '').trim().length === 0

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

export interface RoomEntry {
  /** `room_id`가 없으면 생성, 있으면 참가 — 게스트 발급까지 이 하나에 통합돼 있다. */
  enterRoom(
    body: EnterRoomBody,
    requestedGameCode: string,
    party: boolean,
  ): Promise<EnterRoomResponse>
}

/**
 * 방에 들어갈 정체성을 정한다. 로그인 세션이 살아 있으면 그 회원으로, 아니면 새 게스트로.
 *
 * 토큰이 만료됐다고 입장 자체를 막지는 않는다 — 로그인 화면으로 돌려보내는 것보다
 * 게스트로라도 놀게 하는 편이 낫다. 방에서 쓸 이름은 이번 입장에 적어 낸 값이 우선이다.
 */
const resolveEntrant = async (
  deps: Pick<RoomEntryDependencies, 'users' | 'log'>,
  body: EnterRoomBody,
): Promise<Entrant> => {
  const token = body.session_token
  const member = isBlank(token) ? null : await sessionEntrant(deps, body, token as string)
  if (member !== null) return member
  const guest = await deps.users.createGuest(body.nickname)
  return {
    identity: { userId: guest.userId, nickname: guest.nickname, type: 'GUEST' },
    sessionToken: guest.sessionToken,
  }
}

/** 살아 있는 세션이면 그 회원으로. 만료됐으면 null — 호출자가 게스트로 넘어간다. */
const sessionEntrant = async (
  deps: Pick<RoomEntryDependencies, 'users' | 'log'>,
  body: EnterRoomBody,
  token: string,
): Promise<Entrant | null> => {
  try {
    const member = await deps.users.authenticateSession(token)
    const nickname = isBlank(body.nickname) ? member.nickname : normalizeNickname(body.nickname)
    return { identity: { ...member, nickname }, sessionToken: token }
  } catch (error) {
    if (!(error instanceof SessionAuthenticationError)) throw error
    deps.log.info('만료된 세션으로 입장 시도 — 게스트로 진행합니다')
    return null
  }
}

export const createRoomEntry = (deps: RoomEntryDependencies): RoomEntry => {
  const { users, rooms, catalog } = deps

  const joinExisting = async (entrant: Entrant, roomId: string): Promise<EnterRoomResponse> => {
    const snapshot = await rooms.join(roomId, entrant.identity)
    await users.assignRoom(entrant.identity.userId, roomId, roomId, snapshot.hostId ?? '')
    return response(entrant, roomId, snapshot.gameCode)
  }

  return {
    async enterRoom(body, requestedGameCode, party) {
      // 참가일 때는 game_code를 검증하지 않는다 — 방에 적힌 값이 곧 게임이다.
      const game = isBlank(body.room_id) ? catalog.require(requestedGameCode) : null
      // 대시보드는 플레이어가 아니라 이름을 짓지 않는다 — 닉네임 화면을 건너뛰고 들어온다.
      const dashboard = game !== null && party
      const entrant = await resolveEntrant(
        deps,
        dashboard && isBlank(body.nickname) ? { ...body, nickname: DASHBOARD_NICKNAME } : body,
      )
      if (game === null) return joinExisting(entrant, body.room_id as string)

      const mode: RoomMode = party ? 'PARTY' : 'NORMAL'
      // 정원은 게임이 정한다. 파티 방에서도 그대로 쓴다 — 대시보드는 명단에 들어가지
      // 않으므로 이 수만큼의 컨트롤러가 온전히 들어올 수 있다.
      const roomId = await rooms.createRoom(
        game.maxPlayers,
        entrant.identity.userId,
        game.code,
        mode,
      )
      if (!dashboard) return joinExisting(entrant, roomId)

      // 파티 방을 연 화면은 대시보드다 — 명단에 넣지 않는다. 방장도 대시보드가 아니라
      // 처음 들어온 컨트롤러가 된다(JOIN Lua가 넘겨준다).
      await users.assignRoom(entrant.identity.userId, roomId, roomId, '')
      return response(entrant, roomId, game.code)
    },
  }
}
