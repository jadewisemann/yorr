import type { Server as HttpServer } from 'node:http'
import { WebSocketServer } from 'ws'
import type { GameSocketHandler, WsLogger } from './handler.js'
import { WS_MAX_MESSAGE_BYTES } from './protocol.js'
import type { ClientSocket } from './socket.js'

export interface GameSocketGateway {
  close(): Promise<void>
}

export interface GameSocketGatewayOptions {
  readonly path?: string
  readonly logger?: WsLogger
  /**
   * 핸드셰이크 허용 출처. REST CORS와 **같은 목록**을 넘겨야 한다 — 두 곳에 목록을
   * 복사해 두면 한쪽만 고쳤을 때 REST는 막히고 WebSocket은 열린 상태가 된다.
   * 비우면 출처를 검사하지 않는다.
   */
  readonly allowedOrigins?: readonly string[]
}

/**
 * Origin 검사 규칙: Origin 헤더가 없으면(브라우저가
 * 아니면) 통과시키고, 있으면 **정확 일치**만 허용한다(패턴 아님).
 */
const originAllowed = (origin: string | undefined, allowed: readonly string[]): boolean => {
  if (allowed.length === 0 || origin === undefined) return true
  return allowed.includes('*') || allowed.includes(origin)
}

/**
 * `ws` 서버와 핸들러를 잇는 얇은 배선 — 여기에는 프로토콜 로직을 두지 않는다
 * (핸들러는 소켓 구현을 모르는 채로 단위 테스트된다).
 *
 * **소켓별로 메시지를 직렬 처리한다.** `room.join`의 처리 순서가 계약인데
 * (docs/design/realtime.md) 핸들러가 Redis를 await하는 사이 다음 메시지가
 * 끼어들면 그 순서가 깨진다.
 */
export const attachGameSocketGateway = (
  server: HttpServer,
  handler: GameSocketHandler,
  options: GameSocketGatewayOptions = {},
): GameSocketGateway => {
  const allowedOrigins = options.allowedOrigins ?? []
  const wss = new WebSocketServer({
    server,
    path: options.path ?? '/ws/v1/game',
    maxPayload: WS_MAX_MESSAGE_BYTES,
    verifyClient: ({ origin }, done) => {
      if (originAllowed(origin, allowedOrigins)) return done(true)
      options.logger?.warn({ origin }, '허용되지 않은 출처의 WS 핸드셰이크')
      done(false, 403, 'Forbidden')
    },
  })

  wss.on('connection', (socket) => {
    const client = socket as unknown as ClientSocket
    let queue: Promise<void> = Promise.resolve()
    const serialize = (task: () => Promise<void>): void => {
      queue = queue.then(async () => {
        try {
          await task()
        } catch (error) {
          // 여기까지 온 예외는 버그다 — 소켓 하나 때문에 프로세스를 죽이지는 않는다.
          options.logger?.error({ error }, 'WS 메시지 처리 실패')
        }
      })
    }

    handler.connected(client)
    socket.on('message', (raw) => {
      const data = Array.isArray(raw) ? Buffer.concat(raw) : raw
      serialize(() => handler.message(client, data))
    })
    socket.on('close', () => {
      serialize(() => handler.closed(client))
    })
  })

  return {
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of wss.clients) socket.terminate()
        wss.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
