import type { Page } from '@playwright/test'
import type { Identity, Player, YachtCategory } from './contract'
import { GAME_ID, GUEST, HOST, ROOM_CODE, restSnapshot } from './contract'

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
  scoreCandidates?: Partial<Record<YachtCategory, number>>
  /** 방 참가자 명단. 기본은 호스트 + 게스트 2명. */
  players?: Player[]
}

export interface RestMock {
  readonly enterRoomBodies: EnterRoomBody[]
  readonly startGameCount: number
  readonly returnToLobbyCount: number
  readonly leaveCount: number
  readonly gameFetchCount: number
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

  const enterRoomBodies: EnterRoomBody[] = []
  const unhandled: string[] = []
  let startGameCount = 0
  let returnToLobbyCount = 0
  let leaveCount = 0
  let gameFetchCount = 0

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '')

    if (method === 'POST' && path === '/rooms') {
      const body = (request.postDataJSON() ?? {}) as EnterRoomBody
      enterRoomBodies.push(body)

      if (options.enterRoomFailure) {
        await fulfillFailure(route, options.enterRoomFailure)
        return
      }
      if (body.room_id !== undefined && body.room_id !== roomCode) {
        await fulfillFailure(route, { status: 404, body: 'room_not_found' })
        return
      }

      const identity = body.room_id === undefined ? host : guest
      await route.fulfill({
        json: {
          id: identity.id,
          nickname: body.nickname,
          token: identity.token,
          room_id: roomCode,
        },
      })
      return
    }

    if (method === 'POST' && path === `/rooms/${roomCode}/games`) {
      startGameCount += 1
      if (options.startGameFailure) {
        await fulfillFailure(route, options.startGameFailure)
        return
      }
      await route.fulfill({ json: { gameId, snapshot: startGameSnapshot } })
      return
    }

    if (method === 'POST' && path === `/rooms/${roomCode}/lobby`) {
      returnToLobbyCount += 1
      if (options.returnToLobbyFailure) {
        await fulfillFailure(route, options.returnToLobbyFailure)
        return
      }
      await route.fulfill({ status: 204 })
      return
    }

    if (method === 'DELETE' && path === `/rooms/${roomCode}/players/me`) {
      leaveCount += 1
      await route.fulfill({ status: 204 })
      return
    }

    if (method === 'GET' && path === `/games/${gameId}`) {
      gameFetchCount += 1
      await route.fulfill({ json: gameSnapshot })
      return
    }

    if (method === 'POST' && path === `/games/${gameId}/score-candidates`) {
      await route.fulfill({ json: { candidates: options.scoreCandidates ?? {} } })
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
