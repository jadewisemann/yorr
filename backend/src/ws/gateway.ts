import type { Server as HttpServer } from 'node:http'
import { WebSocketServer } from 'ws'
import type { WsLogger } from './handler.js'
import { WS_MAX_MESSAGE_BYTES } from './protocol.js'
import type { ClientSocket } from './socket.js'

export interface GameSocketGateway {
  close(): Promise<void>
}

/**
 * 게이트웨이가 핸들러에 요구하는 표면. `GameSocketHandler`가 그대로 만족한다.
 * 좁혀 둔 이유는 게이트웨이 자체(프레임 오류 격리 등)를 Redis 없이 테스트하기 위해서다.
 */
export interface SocketEventHandler {
  connected(socket: ClientSocket): void
  message(socket: ClientSocket, raw: unknown): Promise<void>
  closed(socket: ClientSocket): Promise<void>
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

/** `ws`가 프레임 오류에 붙이는 코드(`WS_ERR_*`). 없으면 undefined. */
const wsErrorCode = (error: Error): string | undefined =>
  'code' in error && typeof error.code === 'string' ? error.code : undefined

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
  handler: SocketEventHandler,
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
  // `ws`는 HTTP 서버의 'error'(예: 포트 충돌)를 자기 이름으로 다시 낸다. 구독자가 없으면
  // 그 재발행이 예외가 되어, HTTP 쪽에서 처리된 오류가 프로세스를 한 번 더 죽인다.
  wss.on('error', (error) => options.logger?.error({ reason: error.message }, 'WS 서버 오류'))

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
    // **반드시 구독한다.** 상한 초과(1009)·깨진 UTF-8(1007) 같은 프레임 오류를 `ws`는 이
    // 소켓의 'error'로 알리고 연결은 스스로 닫는다. 구독자가 없으면 EventEmitter가 그것을
    // 예외로 던져 **프로세스 전체가 죽는다** — 인증 없이 프레임 하나로 가능했다
    // (docs/design/realtime.md 「엔드포인트」). 정리는 뒤따르는 'close'가 한다.
    socket.on('error', (error) => {
      options.logger?.warn(
        { code: wsErrorCode(error), reason: error.message },
        '잘못된 WS 프레임 — 이 연결만 닫는다',
      )
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
