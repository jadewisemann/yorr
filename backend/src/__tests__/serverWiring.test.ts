import type { AddressInfo } from 'node:net'
import type { Pool } from 'mysql2/promise'
import { afterEach, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { describeRedis, useRedis } from '../../test/redisHarness.js'
import { loadEnv } from '../config/env.js'
import {
  SWEEP_INTERVAL_MS,
  type SweepSchedule,
  type SweepScheduler,
} from '../game/reconnect/index.js'
import { RedisYachtDiceStateStore } from '../game/yacht/index.js'
import { roomKey } from '../room/keys.js'
import { createServer, type ServerOptions, type YorrServer } from '../server.js'
import type { OutboundEnvelope } from '../ws/envelope.js'

/**
 * **부팅 배선 자체를 고정하는 스위트.**
 *
 * 지금까지 다섯 번 반복된 실패 모드가 있다: 조립을 빠뜨려도 타입·단위 테스트가 전부
 * 통과한다(봇 라우트가 등록되지 않아 404, 게임 모듈 훅이 빈 레지스트리를 봐서 미실행,
 * 라운드 타이머가 다른 브로드캐스터를 받아 방송이 허공으로, 퀵매치 presence가 다른
 * 레지스트리라 자동 시작이 영구 거짓, **운영 라운드 저장소가 인메모리**라 재시작마다
 * 진행 중 게임 소실). 특히 라운드 타이머는 **새 `RoomBroadcaster`·`RoomSessionRegistry`를
 * 넘겨도 조용히 성공한다** — 방송이 아무도 없는 곳으로 나갈 뿐이다. 그래서 여기서는
 * `createServer`가 돌려준 인스턴스로 **진짜 소켓·진짜 Redis까지 효과가 도달하는지**를 본다.
 *
 * 판정 기준은 "타입이 맞는가"가 아니라 **"배선을 빼면 이 테스트가 깨지는가"** 다.
 *
 * MySQL은 이 환경에 없다. 그래서 MySQL을 타는 배선(4.3 프로필·4.4 전적 보관·4.5 랭킹)은
 * 두 갈래로 확인한다: ① 라우트 등록·인증 게이트는 MySQL을 건드리지 않는 지점까지,
 * ② 저장소를 실제로 타는 경로는 **풀 대역**(`mysqlDouble`)을 주입해 질의 자체를 관측한다.
 * 없는 것을 있다고 만들지 않으면서, "배선이 빠지면 질의가 아예 없다"를 볼 수 있다.
 */
describeRedis('서버 배선', () => {
  const redis = useRedis()
  let server: YorrServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  const build = async (
    overrides: Record<string, string> = {},
    extra: ServerOptions = {},
  ): Promise<YorrServer> => {
    const env = {
      ...loadEnv({ CORS_ALLOWED_ORIGINS: 'https://yorr.site', ...overrides }),
      SERVER_PORT: 0,
    }
    server = await createServer(env, { ...extra, redis: redis(), logger: false })
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

  interface Entrant {
    readonly id: string
    readonly token: string
    readonly room_id: string
  }

  const enterRoom = async (
    instance: YorrServer,
    body: Record<string, unknown> = {},
    gameCode = 'YACHT_DICE',
  ): Promise<Entrant> => {
    const response = await instance.app.inject({
      method: 'POST',
      url: `/api/v1/rooms?game_code=${gameCode}`,
      payload: body,
    })
    return response.json()
  }

  const authHeaders = (user: Entrant): Record<string, string> => ({
    'x-user-id': user.id,
    authorization: `Bearer ${user.token}`,
  })

  /** 방에 붙은 소켓 하나 — WS 구독까지 끝난 상태로 돌려준다. */
  const joined = async (url: string, user: Entrant): Promise<Client> => {
    const client = await connect(url)
    client.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: user.room_id, sessionToken: user.token },
    })
    await client.await('room.joined')
    return client
  }

  /**
   * `POST /rooms/{code}/games`. **소켓이 붙은 뒤에** 불러야 한다 — 야추 모듈이
   * 등록된 지금은 시작 직후 첫 턴 타이머가 걸리고, 턴 주인이 오프라인이면
   * `RoundTimerService`가 두 턴 만에 자동 퇴장시켜 방까지 사라진다(2.5의 계약).
   */
  const startGame = async (instance: YorrServer, host: Entrant): Promise<string> => {
    const response = await instance.app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${host.room_id}/games`,
      headers: authHeaders(host),
    })
    expect(response.statusCode).toBe(200)
    return (response.json() as { gameId: string }).gameId
  }

  /**
   * MySQL 풀 대역. **행 모양만 흉내내고 아무 것도 검증하지 않는다** — 여기서 보는
   * 것은 "배선이 저장소까지 닿았는가"(= 질의가 실제로 떠났는가)뿐이다. 실 스키마
   * 검증은 `MYSQL_TEST_URL`이 있는 환경의 저장소 테스트가 한다.
   */
  const mysqlDouble = () => {
    const queries: string[] = []
    const answer = (sql: string): unknown => {
      if (sql.startsWith('INSERT INTO matches (')) return { insertId: 1 }
      // 주간 상위 목록(4.5). 한 줄이면 캐시 히트/미스를 세는 데 충분하다.
      if (sql.includes('GROUP BY p.user_id')) {
        return [{ userId: 'member-1', nickname: '회원', bestScore: 42 }]
      }
      return []
    }
    const query = async (sql: string): Promise<unknown> => {
      queries.push(sql)
      return [answer(sql), []]
    }
    const connection = {
      query,
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }
    return {
      queries,
      pool: { query, getConnection: async () => connection } as unknown as Pool,
      /** 주간 상위 목록 질의가 MySQL로 내려간 횟수 — 캐시 히트는 여기 안 잡힌다. */
      weeklyQueries: (): number =>
        queries.filter((sql) => sql.includes('GROUP BY p.user_id')).length,
      archived: (): boolean => queries.some((sql) => sql.startsWith('INSERT INTO matches (')),
    }
  }

  const weeklyRanking = async (instance: YorrServer): Promise<unknown> => {
    const response = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/rankings/weekly?limit=10',
    })
    expect(response.statusCode).toBe(200)
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

    const client = await joined(url, host)

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
   * **(a) 운영 라운드 상태 저장소는 Redis다.**
   *
   * 타입으로는 `InMemoryRoundStateStore`(2.4의 테스트 시드)도 그대로 들어맞으므로
   * 여기서는 **동작으로** 판정한다: 서버가 만든 상태를 **다른 저장소 인스턴스**가
   * 읽을 수 있어야 한다. 인메모리였다면 프로세스 밖(= 재시작 후)에서 읽을 방법이
   * 없고, 그게 곧 "재시작마다 진행 중 게임 소실"이다.
   */
  it('라운드 상태가 Redis에 남아 다른 인스턴스에서 읽힌다', async () => {
    const instance = await build()
    const host = await enterRoom(instance, { nickname: '호스트' })

    await instance.rounds.synchronization.initialize(host.room_id, 1, [host.id])

    // 재시작을 흉내낸다 — 같은 Redis를 보는 새 저장소.
    const restarted = new RedisYachtDiceStateStore(redis())
    const recovered = await restarted.findByRoomId(host.room_id)
    expect(recovered?.roundNumber).toBe(1)
    expect(recovered?.activePlayerId).toBe(host.id)
    // 키 이름은 backend-java와 공유하는 전환기 계약이다(3.1).
    expect(await redis().exists(`room:${host.room_id}:game:YACHT_DICE:state`)).toBe(1)
    // 스위퍼(2.8)가 쓰는 목록도 같은 저장소에서 나온다.
    expect(await instance.rounds.states.roomIds()).toContain(host.room_id)
  })

  /**
   * **(d) 야추 모듈(3.1)이 등록되어 있다.** REST로 게임을 시작하면 모듈 훅이 돌아야
   * 한다. 여기서 한 번에 네 인스턴스의 동일성이 확인된다: 레지스트리(phase playing) ·
   * 브로드캐스터(소켓이 state.sync를 받음) · 스냅샷 서비스(그 안의 방 명단) ·
   * 라운드 저장소(1라운드 상태 생성).
   */
  it('야추 모듈이 REST 게임 시작에 붙어 있다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })
    const client = await joined(url, host)

    expect(instance.games.byCode('YACHT_DICE')).toBeDefined()
    await startGame(instance, host)

    const sync = await client.await('game.yacht_dice.state.sync')
    expect(sync).toMatchObject({ roomId: host.room_id })
    // markPhase('playing')은 모듈의 몫이다 — 빠지면 끊김이 offline이 아니라 player_left다.
    expect(instance.registry.phaseOf(host.room_id)).toBe('playing')
    const state = await instance.rounds.states.findByRoomId(host.room_id)
    expect(state?.roundNumber).toBe(1)
    expect(state?.activePlayerId).toBe(host.id)
    // 첫 턴 타이머까지 걸렸다(모듈이 타이머를 같은 인스턴스로 받았다는 증거).
    expect(instance.rounds.timer.currentDeadline(host.room_id)).toBeDefined()

    client.socket.close()
  })

  /** **(d) 듀얼 모듈(3.3)** — 2인 방을 시작하면 결투 상태와 방송이 나가야 한다. */
  it('듀얼 모듈이 REST 게임 시작에 붙어 있다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '결투1' }, 'DUEL')
    const guest = await enterRoom(instance, { nickname: '결투2', room_id: host.room_id })
    const hostClient = await joined(url, host)
    const guestClient = await joined(url, { ...guest, room_id: host.room_id })

    expect(instance.games.byCode('DUEL')).toBeDefined()
    await startGame(instance, host)

    const state = await guestClient.await('game.duel.state')
    expect(state).toMatchObject({ roomId: host.room_id, payload: { phase: 'WAITING' } })
    await hostClient.await('game.duel.state.sync')
    expect(instance.registry.phaseOf(host.room_id)).toBe('playing')
    // 결투 상태는 Redis에 있어야 한다(모듈이 스토어를 받았다는 증거).
    expect(await redis().exists(`room:${host.room_id}:game:DUEL:state`)).toBe(1)

    // 몰수 → 종료. **듀얼도 같은 종료 서비스를 받았는지**가 여기서 드러난다 —
    // 스텁이면 결투가 FINISHED가 되어도 `game.over`가 나가지 않는다(3.3의 지적).
    guestClient.send({ type: 'room.leave', ts: Date.now(), payload: {} })
    const over = await hostClient.await('game.duel.game.over')
    expect(over).toMatchObject({ roomId: host.room_id })
    expect(await redis().hget(roomKey(host.room_id), 'phase')).toBe('FINISHED')

    hostClient.socket.close()
    guestClient.socket.close()
  })

  /** **(d) 탁구 모듈(3.4)** — 같은 이유·같은 모양. */
  it('탁구 모듈이 REST 게임 시작에 붙어 있다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '탁구1' }, 'PING_PONG')
    const guest = await enterRoom(instance, { nickname: '탁구2', room_id: host.room_id })
    const hostClient = await joined(url, host)
    const guestClient = await joined(url, { ...guest, room_id: host.room_id })

    expect(instance.games.byCode('PING_PONG')).toBeDefined()
    await startGame(instance, host)

    const state = await guestClient.await('game.ping_pong.state')
    expect(state).toMatchObject({ roomId: host.room_id })
    await hostClient.await('game.ping_pong.state.sync')
    expect(instance.registry.phaseOf(host.room_id)).toBe('playing')
    expect(await redis().exists(`room:${host.room_id}:game:PING_PONG:state`)).toBe(1)

    hostClient.socket.close()
    guestClient.socket.close()
  })

  /**
   * **(b) 라운드 타이머가 받은 게임 종료 판정이 스텁이 아니다.**
   *
   * 예전 자리에는 항상 `false`를 돌려주는 경고 스텁이 있었다. 그 상태에서는 방이
   * FINISHED로 전이되지 않고 `game.over`도 나가지 않아 **클라이언트가 결과 화면으로
   * 넘어가지 못한다**(3.3·3.4가 함께 지적한 항목). 스텁이면 타이머가
   * `round_cap_reached_without_finish`로 조용히 멈춘다.
   *
   * 그래서 판정을 **타이머의 진행 경로로** 시험한다 — `instance.completion`을 직접
   * 부르면 "타이머가 그 인스턴스를 받았는가"는 확인되지 않는다.
   */
  it('라운드 타이머의 턴 진행이 game.over까지 이어진다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })
    const client = await joined(url, host)
    await startGame(instance, host)

    // 마지막 라운드를 만든다 — 모듈은 12라운드로 시작하므로 총 1라운드로 다시 깐다.
    await instance.rounds.synchronization.remove(host.room_id)
    await instance.rounds.synchronization.initialize(host.room_id, 1, [host.id], 1)
    // 주사위는 서버가 만든다(원칙 1) — 제출에는 그 값을 그대로 실어야 한다.
    const rolled = await instance.rounds.synchronization.recordRoll(host.room_id, host.id, {
      roundNumber: 1,
      rollCount: 1,
      held: [false, false, false, false, false],
    })
    const submitted = await instance.rounds.submissions.submit(host.room_id, host.id, {
      roundNumber: 1,
      category: 'choice',
      dice: [...(rolled.activeDice ?? [])],
    })
    await instance.rounds.timer.advanceTurn(host.room_id, submitted)

    const over = await client.await('game.yacht_dice.game.over')
    // 점수는 서버가 재계산한 값이다 — choice는 눈의 합.
    const expected = [...(rolled.activeDice ?? [])].reduce((sum, die) => sum + die, 0)
    expect(over).toMatchObject({
      roomId: host.room_id,
      payload: { rankings: [{ playerId: host.id, rank: 1, total: expected }] },
    })
    // phase(finished)는 스냅샷으로만 전달된다 — 이것까지 나가야 결과 화면으로 넘어간다.
    await client.await('game.yacht_dice.state.sync')
    expect(await redis().hget(roomKey(host.room_id), 'phase')).toBe('FINISHED')
    expect(instance.registry.phaseOf(host.room_id)).toBe('finished')
    // 두 번째 호출은 아무것도 하지 않는다(Lua가 PLAYING만 전이시킨다).
    expect(await instance.completion.finishIfComplete(host.room_id, true)).toBe(false)

    client.socket.close()
  })

  /**
   * **(c) 전적 보관(4.4)** + **(g) 랭킹 캐시 evict(4.5)** — 둘 다 게임 종료 경로에서
   * 확인한다. 판정은 MySQL 풀 대역이 받은 질의다:
   *
   * - `noopMatchArchive` 스텁이 남아 있으면 `INSERT INTO matches`가 **아예 없다**.
   * - 캐시가 배선되지 않았으면 상위 목록 두 번째 조회가 MySQL로 다시 내려간다(1 → 2).
   * - evict가 **다른 인스턴스**를 비우면 종료 후 조회가 여전히 캐시에서 답한다(2가 안 된다).
   */
  it('전적 보관과 랭킹 캐시 evict가 게임 종료 경로에 붙어 있다', async () => {
    const mysql = mysqlDouble()
    const instance = await build({}, { mysql: mysql.pool })
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })
    const client = await joined(url, host)
    const gameId = await startGame(instance, host)
    await instance.rounds.scores.confirm({
      gameId,
      playerId: host.id,
      roundNumber: 1,
      category: 'ones',
      dice: [1, 1, 1, 2, 3],
    })

    // 캐시를 채운다 — 같은 인자의 두 번째 조회는 MySQL로 내려가지 않아야 한다.
    expect(await weeklyRanking(instance)).toMatchObject({
      entries: [{ rank: 1, userId: 'member-1', bestScore: 42 }],
    })
    await weeklyRanking(instance)
    expect(mysql.weeklyQueries()).toBe(1)

    expect(await instance.completion.finishIfComplete(host.room_id, true)).toBe(true)

    expect(mysql.archived()).toBe(true)
    await weeklyRanking(instance)
    expect(mysql.weeklyQueries()).toBe(2)

    client.socket.close()
  })

  /**
   * **(c) MySQL이 없어도 기동·종료는 성공한다.** 풀은 lazy이고(4.1) 보관 실패는
   * 2.7이 삼켜 `onArchiveFailure`로 흘린다 — 눈앞의 사용자가 결과 화면으로 넘어가는
   * 것이 전적 한 줄보다 중요하다.
   */
  it('MySQL이 없어도 게임 종료가 진행된다', async () => {
    const instance = await build({ DB_URL: 'jdbc:mysql://127.0.0.1:1/none' })
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })
    const client = await joined(url, host)
    const gameId = await startGame(instance, host)
    await instance.rounds.scores.confirm({
      gameId,
      playerId: host.id,
      roundNumber: 1,
      category: 'ones',
      dice: [1, 1, 1, 2, 3],
    })

    expect(await instance.completion.finishIfComplete(host.room_id, true)).toBe(true)
    await client.await('game.yacht_dice.game.over')

    client.socket.close()
  })

  /**
   * **(e) 라우트 4개가 등록되어 있다.** 등록 전에는 전부 **404 + 빈 본문**이므로,
   * 각 API의 고유한 인증·검증 응답이 곧 "배선됐는가"의 판정이 된다. 여기서 고른
   * 지점은 모두 MySQL을 건드리기 **전**에 답이 정해지는 곳이다.
   */
  it('조회·프로필·퀵매치·랭킹 라우트가 등록되어 있다', async () => {
    const instance = await build()

    // 2.9 조회 REST — 오류 본문이 JSON `{code,message}`인 유일한 표면이다.
    const scores = await instance.app.inject({ method: 'GET', url: '/api/v1/rooms/ROOM01/scores' })
    expect(scores.statusCode).toBe(401)
    expect(scores.json()).toMatchObject({ code: 'AUTH_FAILED' })
    const results = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/rooms/ROOM01/results',
    })
    expect(results.statusCode).toBe(401)
    // 인증 없는 순수 계산기(Java와 같은 quirk).
    const candidates = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/games/any/score-candidates',
      payload: { dice: [1, 1, 1, 2, 3] },
    })
    expect(candidates.statusCode).toBe(200)
    expect((candidates.json() as { candidates: Record<string, number> }).candidates.ones).toBe(3)

    // 4.3 프로필 — 세션 없는 요청은 401 plain-text `session_expired`(404가 아니다).
    const me = await instance.app.inject({ method: 'GET', url: '/api/v1/users/me' })
    expect(me.statusCode).toBe(401)
    expect(me.body).toBe('session_expired')
    const rename = await instance.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      payload: { nickname: '새이름' },
    })
    expect(rename.statusCode).toBe(401)

    // 3.5 퀵매치 — 401 본문이 `unauthorized`인 것이 이 API만의 계약이다.
    for (const method of ['POST', 'GET', 'DELETE'] as const) {
      const response = await instance.app.inject({ method, url: '/api/v1/quick-matches' })
      expect(response.statusCode).toBe(401)
      expect(response.body).toBe('unauthorized')
    }

    // 4.5 랭킹 — 상위 목록은 무인증이고 정수가 아닌 limit은 400 빈 본문이다.
    const badLimit = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/rankings/weekly?limit=abc',
    })
    expect(badLimit.statusCode).toBe(400)
    expect(badLimit.body).toBe('')
    const myRank = await instance.app.inject({ method: 'GET', url: '/api/v1/rankings/weekly/me' })
    expect(myRank.statusCode).toBe(401)
    expect(myRank.body).toBe('session_expired')
  })

  /**
   * **(e)+④ 퀵매치가 WS 게이트웨이와 같은 레지스트리를 본다.**
   *
   * 자동 시작 조건은 "전원의 소켓이 실제로 열려 있는가"다. 퀵매치가 자기
   * `RoomSessionRegistry`를 새로 만들면 그 조건이 **영구히 거짓**이 되어 매칭된 방이
   * 영원히 시작되지 않는다(타입체크·빌드는 통과한다). 그래서 여기서는 진짜 소켓
   * 두 개로 폴링까지 재현한다.
   */
  it('퀵매치 자동 시작이 진짜 소켓 두 개로 성립한다', async () => {
    const instance = await build()
    const url = await listen(instance)
    // 게스트 세션을 얻는 통로는 방 입장이다. 큐에 들어가려면 세션에 방이 없어야
    // 하므로(`already_in_room`) 곧바로 나온다 — `clearRoom`이 방·티켓을 함께 비운다.
    const first = await enterRoom(instance, { nickname: '한명' }, 'DUEL')
    const second = await enterRoom(instance, { nickname: '두명' }, 'DUEL')
    for (const user of [first, second]) {
      const left = await instance.app.inject({
        method: 'DELETE',
        url: `/api/v1/rooms/${user.room_id}/players/me`,
        headers: authHeaders(user),
      })
      expect(left.statusCode).toBe(204)
    }

    const enter = async (user: Entrant): Promise<{ status: string; roomId: string | null }> => {
      const response = await instance.app.inject({
        method: 'POST',
        url: '/api/v1/quick-matches?game_code=DUEL',
        headers: authHeaders(user),
      })
      expect(response.statusCode).toBe(200)
      return response.json()
    }

    expect(await enter(first)).toMatchObject({ status: 'WAITING' })
    const matched = await enter(second)
    expect(matched.status).toBe('MATCHED')
    const roomId = matched.roomId as string

    // 아직 아무도 접속하지 않았으므로 폴링은 시작시키지 않는다.
    const tooEarly = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/quick-matches',
      headers: authHeaders(first),
    })
    expect(tooEarly.json()).toMatchObject({ status: 'MATCHED' })

    const clients = [
      await joined(url, { ...first, room_id: roomId }),
      await joined(url, { ...second, room_id: roomId }),
    ]
    const polled = await instance.app.inject({
      method: 'GET',
      url: '/api/v1/quick-matches',
      headers: authHeaders(first),
    })

    expect(polled.json()).toMatchObject({ status: 'PLAYING', roomId })
    // 시작은 라이프사이클 → 듀얼 모듈까지 내려간다(같은 레지스트리·같은 모듈 등록).
    await clients[0]?.await('game.duel.state')
    expect(instance.registry.phaseOf(roomId)).toBe('playing')

    for (const client of clients) client.socket.close()
  })

  /**
   * **(f) 고아 라운드 상태 스위퍼(2.8)가 `listen()`에서 돌기 시작한다.**
   *
   * 5분을 기다리지 않으려고 주기 실행 시임을 주입한다(`SweepScheduler` — 2.8이
   * 이 목적으로 남긴 자리). 확인하는 것은 셋이다: `createServer`만으로는 걸리지
   * 않는다 · `listen()`이 5분 주기로 건다 · 발화하면 **서버의** 라운드 저장소에서
   * 고아가 사라진다 · `close()`가 해제한다.
   */
  it('listen()이 고아 상태 스위퍼를 걸고 close()가 해제한다', async () => {
    const tasks: (() => void)[] = []
    const intervals: number[] = []
    let stopped = 0
    const scheduler: SweepScheduler = {
      every: (intervalMs, task): SweepSchedule => {
        intervals.push(intervalMs)
        tasks.push(task)
        return { stop: () => (stopped += 1) }
      },
    }

    const instance = await build({}, { sweepScheduler: scheduler })
    expect(tasks).toHaveLength(0)
    await listen(instance)
    expect(intervals).toEqual([SWEEP_INTERVAL_MS])

    // 방이 없는 라운드 상태 = 고아. Redis 저장소부터는 재시작이 이것을 치워 주지 않는다.
    await instance.rounds.synchronization.initialize('GHOST1', 1, ['ghost'])
    expect(await instance.rounds.states.findByRoomId('GHOST1')).toBeDefined()

    tasks[0]?.()
    await expect
      .poll(() => instance.rounds.states.findByRoomId('GHOST1'), { timeout: 2_000 })
      .toBeUndefined()

    await instance.close()
    server = undefined
    expect(stopped).toBe(1)
  })

  /**
   * **(h) 이탈 경로가 `timer.removePlayer`까지 닿는다.**
   *
   * 웨이브 2 배선이 "미연결"로 남긴 항목이지만, **게임 모듈 등록만으로 연결된다**:
   * `ws/handler.ts`의 `room.leave`가 phase playing일 때 `games.byCode(...).removePlayer`를
   * 부르고, 야추 모듈이 그것을 `timers.removePlayer`로 넘긴다. 턴 순서에서 실제로
   * 빠지는 것은 타이머만 하는 일이라 그 관측이 판정 기준이다.
   */
  it('WS room.leave가 게임 모듈을 통해 턴 순서에서 빼낸다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })
    const guest = await enterRoom(instance, { nickname: '참가자', room_id: host.room_id })
    const hostClient = await joined(url, host)
    const guestClient = await joined(url, { ...guest, room_id: host.room_id })
    await startGame(instance, host)

    const before = await instance.rounds.states.findByRoomId(host.room_id)
    expect(before?.participantOrder).toContain(guest.id)

    guestClient.send({ type: 'room.leave', ts: Date.now(), payload: {} })

    const left = await hostClient.await('room.player_left')
    expect(left).toMatchObject({ payload: { playerId: guest.id } })
    await expect
      .poll(
        async () =>
          (await instance.rounds.states.findByRoomId(host.room_id))?.participantOrder ?? [],
        { timeout: 2_000 },
      )
      .toEqual([host.id])

    hostClient.socket.close()
    guestClient.socket.close()
  })

  /**
   * 점수 파이프라인이 **서버와 같은 Redis**에 붙어 있는지. `RedisScoreBoardStore`는
   * `defineCommand`로 CONFIRM_SCORE Lua를 자기 클라이언트에 등록하므로, 다른 연결을
   * 잡고 있으면 여기서 바로 드러난다.
   */
  it('점수 확정 서비스가 서버의 Redis에 붙어 있다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })
    // CONFIRM_SCORE Lua가 game:{id} ↔ 방 명단을 양방향으로 검증하므로 진짜 게임이 필요하다.
    const client = await joined(url, host)
    const gameId = await startGame(instance, host)

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

    client.socket.close()
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

  /**
   * 메트릭 수집기가 **그** 레지스트리를 받았는지 본다. 새 `RoomSessionRegistry`를
   * 넘기면 게이지가 영구히 0인데 타입도 단위 테스트도 통과한다 — 배선 누락 여섯 번째
   * 자리다. 배선을 아예 빼면 `/actuator/prometheus`가 503이 되어 여기서 깨진다.
   */
  it('메트릭 게이지가 실제 방·소켓을 센다', async () => {
    const instance = await build()
    const url = await listen(instance)
    const host = await enterRoom(instance, { nickname: '호스트' })
    const client = await joined(url, host)
    await startGame(instance, host)

    const response = await instance.app.inject({ method: 'GET', url: '/actuator/prometheus' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('yorr_rooms_active 1')
    expect(response.body).toContain('yorr_game_participants_active{game="YACHT_DICE"} 1')

    client.socket.close()
  })
})
