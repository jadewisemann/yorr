import type { Server as HttpServer } from 'node:http'
import { type WebSocket, WebSocketServer } from 'ws'
import { envelope, parseInbound, WS_PROTOCOL_VERSION } from './envelope.js'
import { RoomSocketRegistry } from './registry.js'

// 프론트는 sys.connected의 heartbeatIntervalMs 간격으로 sys.ping을 보낸다.
const HEARTBEAT_INTERVAL_MS = 25_000

export interface GameSocketGateway {
  registry: RoomSocketRegistry
  close(): Promise<void>
}

const send = (socket: WebSocket, message: ReturnType<typeof envelope>): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

export const attachGameSocketGateway = (
  server: HttpServer,
  path = '/ws/v1/game',
): GameSocketGateway => {
  const wss = new WebSocketServer({ server, path })
  const registry = new RoomSocketRegistry()

  wss.on('connection', (socket) => {
    send(
      socket,
      envelope('sys.connected', {
        serverTs: Date.now(),
        protocolVersion: WS_PROTOCOL_VERSION,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      }),
    )

    socket.on('message', (raw) => {
      const message = parseInbound(raw)
      if (!message) return

      if (message.type === 'sys.ping') {
        send(socket, envelope('sys.pong', { serverTs: Date.now() }))
        return
      }
      // room.* · round.* · 게임별 메시지는 마이그레이션 단계에서 채운다 — PLANS.md Phase 1·2
    })

    socket.on('close', () => {
      registry.unsubscribeAll(socket)
    })
  })

  return {
    registry,
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of wss.clients) socket.terminate()
        wss.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
