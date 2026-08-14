import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { describeRedis, useRedis } from '../../test/redisHarness.js'
import { loadEnv } from '../config/env.js'
import { createServer, type YorrServer } from '../server.js'
import type { OutboundEnvelope } from '../ws/envelope.js'

/**
 * **부팅 배선 자체를 고정하는 스위트.**
 *
 * 지금까지 두 번 반복된 실패 모드가 있다: 조립을 빠뜨려도 타입·단위 테스트가 전부
 * 통과한다(봇 라우트가 등록되지 않아 404, 게임 모듈 훅이 빈 레지스트리를 봐서 미실행).
 * 특히 라운드 타이머는 **새 `RoomBroadcaster`·`RoomSessionRegistry`를 넘겨도 조용히
 * 성공한다** — 방송이 아무도 없는 곳으로 나갈 뿐이다. 그래서 여기서는 `createServer`가
 * 돌려준 인스턴스로 **진짜 소켓까지 메시지가 도달하는지**를 본다.
 *
 * MySQL은 이 환경에 없다. 소셜 로그인은 저장소를 건드리지 않는 지점(라우트 등록·
 * 미설정 503·세션 교환 실패)까지만 확인한다 — 없는 것을 있다고 만들지 않는다.
 */
describeRedis('서버 배선', () => {
  const redis = useRedis()
  let server: YorrServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  const build = async (overrides: Record<string, string> = {}): Promise<YorrServer> => {
    const env = {
      ...loadEnv({ CORS_ALLOWED_ORIGINS: 'https://yorr.site', ...overrides }),
      SERVER_PORT: 0,
    }
    server = await createServer(env, { redis: redis(), logger: false })
    return server
  }

  /** 실제 소켓이 필요한 검증만 리슨한다(REST는 `app.inject`로 충분하다). */
  const listen = async (instance: YorrServer): Promise<string> => {
    await instance.listen()
    const { port } = instance.app.server.address() as AddressInfo
    return `ws://127.0.0.1:${port}/ws/v1/game`
  }

  interface Client {
    socket: WebSocket
    received: OutboundEnvelope[]
    send(message: unknown): void
    await(type: string): Promise<OutboundEnvelope>
  }

  const connect = async (url: string): Promise<Client> => {
    const socket = new WebSocket(url)
    const received: OutboundEnvelope[] = []
    socket.on('message', (raw) => received.push(JSON.parse(raw.toString()) as OutboundEnvelope))
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return {
      socket,
      received,
      send: (message) => socket.send(JSON.stringify(message)),
      await: async (type) => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const matched = received.find((message) => message.type === type)
          if (matched !== undefined) return matched
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        throw new Error(`${type}을(를) 받지 못했다: ${received.map((m) => m.type).join(',')}`)
      },
    }
  }

  const enterRoom = async (
    instance: YorrServer,
    body: Record<string, unknown> = {},
  ): Promise<{ id: string; token: string; room_id: string }> => {
    const response = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/rooms?game_code=YACHT_DICE',
      payload: body,
    })
    return response.json()
  }

  /**
   * 이 테스트 하나가 두 함정을 동시에 막는다. 타이머가 자기 브로드캐스터를 새로
   * 만들었다면 `round.start`가 이 소켓에 도착하지 않고, 자기 레지스트리를 새로
   * 만들었다면 접속한 플레이어가 "오프라인"으로 보여 타이머가 아예 걸리지 않는다
   * (`start`가 null을 반환한다).
   */
  it('라운드 타이머가 WS 게이트웨이와 같은 브로드캐스터·레지스트리를 쓴다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })

    const client = await connect(url)
    client.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: host.room_id, sessionToken: host.token },
    })
    await client.await('room.joined')

    const state = await instance.rounds.synchronization.initialize(host.room_id, 1, [host.id])
    const deadline = await instance.rounds.timer.start(host.room_id, state)

    // null이면 레지스트리가 갈라져 접속자를 오프라인으로 판정했다는 뜻이다.
    expect(deadline).not.toBeNull()
    expect(instance.rounds.timer.currentDeadline(host.room_id)).toBe(deadline)
    const started = await client.await('game.yacht_dice.round.start')
    expect(started).toMatchObject({
      roomId: host.room_id,
      payload: { roundNumber: 1, activePlayerId: host.id, turnOrder: [host.id] },
    })

    instance.rounds.timer.cancelRoom(host.room_id)
    client.socket.close()
  })

  /**
   * 점수 파이프라인이 **서버와 같은 Redis**에 붙어 있는지. `RedisScoreBoardStore`는
   * `defineCommand`로 CONFIRM_SCORE Lua를 자기 클라이언트에 등록하므로, 다른 연결을
   * 잡고 있으면 여기서 바로 드러난다.
   */
  it('점수 확정 서비스가 서버의 Redis에 붙어 있다', async () => {
    const instance = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })
    // CONFIRM_SCORE Lua가 game:{id} ↔ 방 명단을 양방향으로 검증하므로 진짜 게임이 필요하다.
    const started = await instance.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.room_id}/games`,
      headers: { 'x-user-id': host.id, authorization: `Bearer ${host.token}` },
    })
    const { gameId } = started.json() as { gameId: string }

    expect(await instance.rounds.scores.openCategories(gameId, host.id)).toHaveLength(12)
    await instance.rounds.scores.confirm({
      gameId,
      playerId: host.id,
      roundNumber: 1,
      category: 'ones',
      dice: [1, 1, 1, 2, 3],
    })

    const open = await instance.rounds.scores.openCategories(gameId, host.id)
    expect(open).toHaveLength(11)
    expect(open).not.toContain('ones')
    // 점수판은 서버가 재계산한다 — 클라이언트 점수는 와이어에 존재하지도 않는다.
    expect((await instance.rounds.scores.scoreBoard(gameId, host.id)).categories.ones).toBe(3)
  })

  /** `close()`가 마감 스케줄러를 멈추지 않으면 남은 타이머가 닫힌 Redis를 두드린다. */
  it('close()가 라운드 마감 스케줄러를 멈춘다', async () => {
    const instance = await build()
    let fired = false

    instance.rounds.deadlines.schedule('ROOM01', 1, Date.now() + 60, () => {
      fired = true
    })
    await instance.close()
    server = undefined
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(fired).toBe(false)
  })

  /**
   * 소셜 로그인 라우트가 실제로 등록됐는지. 미설정 제공자는 **404가 아니라 503**이
   * 계약이므로(auth.md), 이 구분이 곧 "배선됐는가"의 판정이 된다.
   */
  it('소셜 로그인 라우트가 등록되어 있다', async () => {
    const instance = await build()

    // 설정이 비어 있어도 라우트는 있다 — 없으면 404가 나온다.
    const unconfigured = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/authorize',
    })
    expect(unconfigured.statusCode).toBe(503)

    // 세션 교환·확인·로그아웃은 MySQL을 타지 않는다(Redis만).
    const exchange = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/session',
      payload: { code: 'no-such-code' },
    })
    expect(exchange.statusCode).toBe(401)
    expect(exchange.body).toBe('invalid_login_code')

    const me = await instance.app.inject({ method: 'GET', url: '/api/v1/auth/me' })
    expect(me.statusCode).toBe(401)
    expect(me.body).toBe('session_expired')

    const logout = await instance.app.inject({ method: 'DELETE', url: '/api/v1/auth/session' })
    expect(logout.statusCode).toBe(204)
  })

  it('설정된 제공자의 authorize는 제공자로 302한다', async () => {
    const instance = await build({
      KAKAO_CLIENT_ID: 'rest-api-key',
      KAKAO_REDIRECT_URI: 'http://localhost:8080/api/v1/auth/kakao/callback',
    })

    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/auth/kakao/authorize',
    })

    expect(response.statusCode).toBe(302)
    const location = new URL(String(response.headers.location))
    expect(location.origin + location.pathname).toBe('https://kauth.kakao.com/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('rest-api-key')
    // state는 Redis에 실제로 발급돼 있어야 한다(스토어가 서버의 Redis에 붙었다는 증거).
    const state = location.searchParams.get('state')
    expect(await redis().exists(`auth:oauth-state:${state}`)).toBe(1)
  })

  /**
   * 기동 경로는 MySQL을 **건드리지 않는다**. `verifyMigrations`가 `listen()`에 들어가면
   * DB 없는 개발·CI 환경에서 WS 통합 테스트가 전부 깨진다(그래서 `main.ts`에 있다).
   */
  it('listen()이 MySQL을 요구하지 않는다', async () => {
    const instance = await build({ DB_URL: 'jdbc:mysql://127.0.0.1:1/none' })

    await expect(listen(instance)).resolves.toContain('ws://127.0.0.1:')
    const health = await instance.app.inject({ method: 'GET', url: '/actuator/health' })
    expect(health.json()).toEqual({ status: 'UP' })
  })
})
