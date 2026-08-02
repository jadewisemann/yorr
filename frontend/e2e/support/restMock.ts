import type { Page } from '@playwright/test'
import type { Identity, Player } from './contract'
import { GAME_ID, GUEST, HOST, KAKAO_LOGIN_CODE, MEMBER, ROOM_CODE, restSnapshot } from './contract'

/**
 * REST 계약 mock. 프로덕션 빌드에는 MSW가 없으므로 라우팅 단계에서 응답을 만든다.
 * 경로·본문은 src/api/gameApi.ts가 실제로 부르는 모양 그대로다 —
 * 응답 형태가 어긋나면 gameApi의 파서가 던져 계약 회귀로 드러난다.
 */

export interface EnterRoomBody {
  nickname: string
  room_id?: string
}

export interface RestFailure {
  status: number
  /** 문자열이면 text/plain으로, 객체면 JSON으로 응답한다(둘 다 실서버에서 온다). */
  body: string | Record<string, unknown>
}

export interface RestMockOptions {
  roomCode?: string
  host?: Identity
  guest?: Identity
  gameId?: string
  /** POST /rooms 실패 시나리오. 지정하면 코드 일치 여부와 무관하게 이 응답을 준다. */
  enterRoomFailure?: RestFailure
  /** POST /rooms/:code/games 응답 스냅샷. 기본은 game 없는 PLAYING(진행 상태는 WS가 SSOT). */
  startGameSnapshot?: Record<string, unknown>
  /** GET /games/:id 응답 스냅샷. */
  gameSnapshot?: Record<string, unknown>
  startGameFailure?: RestFailure
  returnToLobbyFailure?: RestFailure
  /** 방 참가자 명단. 기본은 호스트 + 게스트 2명. */
  players?: Player[]
  /** 로그인 회원 신원. 기본은 MEMBER. */
  member?: Identity
  /** GET /auth/kakao/authorize의 결과. 실제 카카오 화면은 거치지 않고 그 결과만 흉내낸다. */
  kakaoLoginOutcome?: 'success' | 'canceled'
  /** POST /auth/session(코드 교환) 실패 시나리오. */
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
  /** mock이 알아보지 못한 요청. 테스트 끝에 비어 있어야 한다. */
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

  // 실제 카카오 동의 화면은 거치지 않는다 — 서버가 그 뒤에 돌려주는 결과(코드 또는 취소 사유)만 흉내낸다.
  // WebKit은 route.fulfill의 3xx 상태를 허용하지 않아, HTTP redirect 대신 JS location.replace로 옮긴다.
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
    // 실서버는 코드 문자열을 text/plain으로 준다 — client.ts의 textErrorPayload 경로.
    await route.fulfill({
      status: failure.status,
      contentType: 'text/plain; charset=utf-8',
      body: failure.body,
    })
    return
  }
  await route.fulfill({ status: failure.status, json: failure.body })
}
