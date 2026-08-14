import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { loadEnv } from '../../config/env.js'
import { createServer, type YorrServer } from '../../server.js'
import type { OutboundEnvelope } from '../envelope.js'

/**
 * 실제 소켓 위에서 도는 배선 검증 — 프론트 e2e `dev:real`의 로비 스위트를 인프로세스로
 * 좁혀 옮긴 것이다(방 생성+스냅샷, 게스트 join 브로드캐스트, 미존재 코드 ROOM_NOT_FOUND).
 * 프로토콜 세부는 handler.test.ts가 본다.
 */
describeRedis('WebSocket 게이트웨이', () => {
  const redis = useRedis()
  let server: YorrServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  const start = async (): Promise<string> => {
    // 포트 0 = 빈 포트 자동 할당. 스킴은 양수만 받으므로(운영 계약) 여기서만 덮어쓴다.
    const env = { ...loadEnv({ CORS_ALLOWED_ORIGINS: 'https://yorr.site' }), SERVER_PORT: 0 }
    server = await createServer(env, { redis: redis(), logger: false })
    await server.listen()
    const { port } = server.app.server.address() as AddressInfo
    return `ws://127.0.0.1:${port}/ws/v1/game`
  }

  /** 소켓 하나가 받은 메시지를 순서대로 모은다. */
  const connect = async (url: string, origin?: string): Promise<Client> => {
    const socket = new WebSocket(url, origin ? { origin } : {})
    const received: OutboundEnvelope[] = []
    socket.on('message', (raw) => received.push(JSON.parse(raw.toString()) as OutboundEnvelope))
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return {
      socket,
      received,
      send: (message: unknown) => socket.send(JSON.stringify(message)),
      await: async (type: string, nth = 1) => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const matched = received.filter((message) => message.type === type)
          if (matched.length >= nth) return matched[nth - 1] as OutboundEnvelope
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        throw new Error(`${type}을(를) 받지 못했다: ${received.map((m) => m.type).join(',')}`)
      },
    }
  }

  interface Client {
    socket: WebSocket
    received: OutboundEnvelope[]
    send(message: unknown): void
    /** `nth`번째로 도착한 그 타입의 메시지. 같은 타입이 여러 번 오는 흐름(voice.peers)에 쓴다. */
    await(type: string, nth?: number): Promise<OutboundEnvelope>
  }

  const enterRoom = async (
    body: Record<string, unknown> = {},
  ): Promise<{ id: string; token: string; room_id: string }> => {
    const response = await (server as YorrServer).app.inject({
      method: 'POST',
      url: '/api/v1/rooms?game_code=YACHT_DICE',
      payload: body,
    })
    return response.json()
  }

  it('REST로 만든 방에 join하면 스냅샷을 받고, 다음 사람의 입장이 방송된다', async () => {
    const url = await start()
    const host = await enterRoom({ nickname: '호스트' })

    const hostClient = await connect(url)
    expect((await hostClient.await('sys.connected')).payload).toMatchObject({
      protocolVersion: 1,
      heartbeatIntervalMs: 30_000,
    })
    hostClient.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: host.room_id, sessionToken: host.token },
    })
    const joined = await hostClient.await('room.joined')
    expect(joined).toMatchObject({ roomId: host.room_id, payload: { you: host.id } })
    expect((joined.payload as { snapshot: { phase: string } }).snapshot).toMatchObject({
      roomId: host.room_id,
      gameCode: 'YACHT_DICE',
      phase: 'waiting',
      hostId: host.id,
      capacity: 6,
    })

    const guest = await enterRoom({ nickname: '참가자', room_id: host.room_id })
    const guestClient = await connect(url)
    guestClient.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: host.room_id, sessionToken: guest.token },
    })

    expect(await hostClient.await('room.player_joined')).toMatchObject({
      payload: { player: { playerId: guest.id, nickname: '참가자', status: 'online' } },
    })
    hostClient.socket.close()
    guestClient.socket.close()
  })

  /** 음성은 방 전체 방송(voice.peers)과 유니캐스트(voice.signaled)가 섞인 유일한 흐름이다. */
  it('voice.join은 방 전원에게, voice.signal은 지목한 상대에게만 간다', async () => {
    const url = await start()
    const host = await enterRoom({ nickname: '호스트' })
    const guest = await enterRoom({ nickname: '참가자', room_id: host.room_id })

    const hostClient = await connect(url)
    hostClient.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: host.room_id, sessionToken: host.token },
    })
    await hostClient.await('room.joined')
    const guestClient = await connect(url)
    guestClient.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: host.room_id, sessionToken: guest.token },
    })
    await guestClient.await('room.joined')

    guestClient.send({ type: 'voice.join', ts: Date.now(), payload: {} })

    // 통화에 참여하지 않은 호스트도 명단을 받는다.
    expect(await hostClient.await('voice.peers')).toMatchObject({
      roomId: host.room_id,
      payload: { peers: [guest.id] },
    })
    await guestClient.await('voice.peers')

    guestClient.send({
      type: 'voice.signal',
      ts: Date.now(),
      payload: {
        to: host.id,
        from: '사칭',
        data: { kind: 'description', description: { type: 'offer', sdp: 'v=0' } },
      },
    })

    expect(await hostClient.await('voice.signaled')).toMatchObject({
      roomId: host.room_id,
      payload: { from: guest.id, data: { kind: 'description' } },
    })
    expect(guestClient.received.map((message) => message.type)).not.toContain('voice.signaled')

    // 탭을 닫으면 voice.leave 없이 끊긴다 — 남은 사람이 빈 명단을 받아야 한다.
    guestClient.socket.close()
    const peers = await hostClient.await('voice.peers', 2)
    expect(peers).toMatchObject({ payload: { peers: [] } })
    hostClient.socket.close()
  })

  it('없는 방에 join하면 ROOM_NOT_FOUND를 받고 연결은 유지된다', async () => {
    const url = await start()
    const client = await connect(url)
    await client.await('sys.connected')

    client.send({
      type: 'room.join',
      ts: Date.now(),
      payload: { roomId: 'GONE01', nickname: '유령' },
      msgId: 'join-gone',
    })

    expect(await client.await('error')).toMatchObject({
      payload: { code: 'ROOM_NOT_FOUND', refMsgId: 'join-gone' },
    })
    expect(client.socket.readyState).toBe(WebSocket.OPEN)
    client.socket.close()
  })

  it('sys.ping에 sys.pong으로 답한다', async () => {
    const url = await start()
    const client = await connect(url)
    await client.await('sys.connected')

    client.send({ type: 'sys.ping', ts: Date.now(), payload: { clientTs: Date.now() } })

    expect((await client.await('sys.pong')).payload).toHaveProperty('serverTs')
    client.socket.close()
  })

  /** REST CORS와 같은 목록을 쓴다 — dev 출처가 운영에 새지 않도록 fail-safe. */
  it('허용되지 않은 출처의 핸드셰이크는 403으로 막는다', async () => {
    const url = await start()

    await expect(connect(url, 'https://evil.example')).rejects.toThrow('403')
    // Origin 헤더가 없는 클라이언트(브라우저 아님)는 통과한다.
    const client = await connect(url)
    await client.await('sys.connected')
    client.socket.close()
  })
})
