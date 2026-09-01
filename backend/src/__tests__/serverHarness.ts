import type { AddressInfo } from 'node:net'
import type { Redis } from 'ioredis'
import type { Pool } from 'mysql2/promise'
import { afterEach, expect } from 'vitest'
import { WebSocket } from 'ws'
import { loadEnv } from '../config/env.js'
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
export interface Client {
  socket: WebSocket
  received: OutboundEnvelope[]
  send(message: unknown): void
  await(type: string): Promise<OutboundEnvelope>
}

export interface Entrant {
  readonly id: string
  readonly token: string
  readonly room_id: string
}

export function useServer(redis: () => Redis) {
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

  return {
    /** 진행 중인 인스턴스. 몇몇 검사는 스스로 닫고 확인한다. */
    get server() {
      return server
    },
    /** 검사가 스스로 `close()`한 뒤 부른다 — afterEach가 두 번 닫지 않게 놓아 준다. */
    release() {
      server = undefined
    },
    build,
    listen,
    connect,
    enterRoom,
    authHeaders,
    joined,
    startGame,
    mysqlDouble,
    weeklyRanking,
  }
}
