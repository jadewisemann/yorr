import type { Page } from '@playwright/test'
import type { Identity, Player } from './contract'
import { GAME_ID, GUEST, HOST, KAKAO_LOGIN_CODE, MEMBER, ROOM_CODE, restSnapshot } from './contract'

export interface EnterRoomBody {
  nickname: string
  room_id?: string
}

export interface RestFailure {
  status: number

  body: string | Record<string, unknown>
}

export interface RestMockOptions {
  roomCode?: string
  host?: Identity
  guest?: Identity
  gameId?: string

  enterRoomFailure?: RestFailure

  startGameSnapshot?: Record<string, unknown>

  gameSnapshot?: Record<string, unknown>
  startGameFailure?: RestFailure
  returnToLobbyFailure?: RestFailure

  players?: Player[]

  member?: Identity

  kakaoLoginOutcome?: 'success' | 'canceled'

  authExchangeFailure?: RestFailure
}

export interface RestMock {
  readonly enterRoomBodies: EnterRoomBody[]
  readonly startGameCount: number
  readonly returnToLobbyCount: number
  readonly leaveCount: number
  readonly gameFetchCount: number
  readonly authSessionBodies: { code?: string }[]
  readonly closeSessionCount: number

  readonly unhandled: string[]
}

export async function mockRestApi(page: Page, options: RestMockOptions = {}): Promise<RestMock> {
  const roomCode = options.roomCode ?? ROOM_CODE
  const host = options.host ?? HOST
  const guest = options.guest ?? GUEST
  const gameId = options.gameId ?? GAME_ID
  const players = options.players ?? [
    { playerId: host.id, nickname: host.nickname, status: 'online' },
    { playerId: guest.id, nickname: guest.nickname, status: 'online' },
  ]

  const startGameSnapshot =
    options.startGameSnapshot ??
    restSnapshot({ phase: 'PLAYING', players, gameId, hostId: host.id })
  const gameSnapshot =
    options.gameSnapshot ?? restSnapshot({ phase: 'PLAYING', players, gameId, hostId: host.id })
  const member = options.member ?? MEMBER

  const enterRoomBodies: EnterRoomBody[] = []
  const authSessionBodies: { code?: string }[] = []
  const unhandled: string[] = []
  let startGameCount = 0
  let returnToLobbyCount = 0
  let leaveCount = 0
  let gameFetchCount = 0
  let closeSessionCount = 0

  type Route = Parameters<Parameters<Page['route']>[1]>[0]
  type Request = ReturnType<Route['request']>

  async function handleEnterRoom(route: Route, request: Request) {
    const body = (request.postDataJSON() ?? {}) as EnterRoomBody
    enterRoomBodies.push(body)

    if (options.enterRoomFailure) return fulfillFailure(route, options.enterRoomFailure)
    if (body.room_id !== undefined && body.room_id !== roomCode) {
      return fulfillFailure(route, { status: 404, body: 'room_not_found' })
    }

    const identity = body.room_id === undefined ? host : guest
    await route.fulfill({
      json: { id: identity.id, nickname: body.nickname, token: identity.token, room_id: roomCode },
    })
  }

  async function handleStartGame(route: Route, _request: Request) {
    startGameCount += 1
    if (options.startGameFailure) return fulfillFailure(route, options.startGameFailure)
    await route.fulfill({ json: { gameId, snapshot: startGameSnapshot } })
  }

  async function handleReturnToLobby(route: Route, _request: Request) {
    returnToLobbyCount += 1
    if (options.returnToLobbyFailure) return fulfillFailure(route, options.returnToLobbyFailure)
    await route.fulfill({ status: 204 })
  }

  async function handleLeaveRoom(route: Route, _request: Request) {
    leaveCount += 1
    await route.fulfill({ status: 204 })
  }

  async function handleGetGame(route: Route, _request: Request) {
    gameFetchCount += 1
    await route.fulfill({ json: gameSnapshot })
  }

  async function handleKakaoAuthorize(route: Route, _request: Request) {
    const query =
      options.kakaoLoginOutcome === 'canceled' ? { error: 'canceled' } : { code: KAKAO_LOGIN_CODE }
    const target = `/auth/callback?${new URLSearchParams(query).toString()}`
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>location.replace(${JSON.stringify(target)})</script>`,
    })
  }

  async function handleAuthSession(route: Route, request: Request) {
    const body = (request.postDataJSON() ?? {}) as { code?: string }
    authSessionBodies.push(body)
    if (options.authExchangeFailure) return fulfillFailure(route, options.authExchangeFailure)
    await route.fulfill({
      json: {
        userId: member.id,
        nickname: member.nickname,
        type: 'MEMBER',
        sessionToken: member.token,
      },
    })
  }

  async function handleCloseSession(route: Route, _request: Request) {
    closeSessionCount += 1
    await route.fulfill({ status: 204 })
  }

  const routes: [string, string, (route: Route, request: Request) => Promise<void>][] = [
    ['POST', '/rooms', handleEnterRoom],
    ['POST', `/rooms/${roomCode}/games`, handleStartGame],
    ['POST', `/rooms/${roomCode}/lobby`, handleReturnToLobby],
    ['DELETE', `/rooms/${roomCode}/players/me`, handleLeaveRoom],
    ['GET', `/games/${gameId}`, handleGetGame],
    ['GET', '/auth/kakao/authorize', handleKakaoAuthorize],
    ['POST', '/auth/session', handleAuthSession],
    ['DELETE', '/auth/session', handleCloseSession],
  ]

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '')

    const match = routes.find(
      ([routeMethod, routePath]) => routeMethod === method && routePath === path,
    )
    if (match) {
      await match[2](route, request)
      return
    }

    unhandled.push(`${method} ${path}`)
    await route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: path } })
  })

  return {
    get enterRoomBodies() {
      return enterRoomBodies
    },
    get startGameCount() {
      return startGameCount
    },
    get returnToLobbyCount() {
      return returnToLobbyCount
    },
    get leaveCount() {
      return leaveCount
    },
    get gameFetchCount() {
      return gameFetchCount
    },
    get authSessionBodies() {
      return authSessionBodies
    },
    get closeSessionCount() {
      return closeSessionCount
    },
    get unhandled() {
      return unhandled
    },
  }
}

async function fulfillFailure(
  route: Parameters<Parameters<Page['route']>[1]>[0],
  failure: RestFailure,
) {
  if (typeof failure.body === 'string') {
    await route.fulfill({
      status: failure.status,
      contentType: 'text/plain; charset=utf-8',
      body: failure.body,
    })
    return
  }
  await route.fulfill({ status: failure.status, json: failure.body })
}
