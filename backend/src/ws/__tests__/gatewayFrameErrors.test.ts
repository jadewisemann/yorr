import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  attachGameSocketGateway,
  type GameSocketGateway,
  type SocketEventHandler,
} from '../gateway.js'
import type { WsLogger } from '../handler.js'
import { WS_MAX_MESSAGE_BYTES } from '../protocol.js'
import type { ClientSocket } from '../socket.js'

/**
 * 회귀(2026-09-30): 게이트웨이가 소켓의 'error'를 구독하지 않아, 상한을 넘긴 메시지나
 * 깨진 UTF-8 프레임 **하나**가 EventEmitter 예외로 프로세스를 죽였다. 핸드셰이크에 인증이
 * 없으므로 누구나 보낼 수 있었다. 기대 동작은 "그 연결만 닫고, 서버와 다른 연결은 그대로"다.
 *
 * Redis가 필요 없도록 실제 `GameSocketHandler` 대신 메아리 핸들러를 붙인다 — 여기서 보는
 * 것은 게이트웨이의 격리이지 프로토콜이 아니다.
 */

/** 받은 텍스트를 `echo:`를 붙여 돌려주고, 연결·종료를 순서대로 기록한다. */
class EchoHandler implements SocketEventHandler {
  readonly sockets: ClientSocket[] = []
  readonly closedSockets = new Set<ClientSocket>()

  connected(socket: ClientSocket): void {
    this.sockets.push(socket)
  }

  async message(socket: ClientSocket, raw: unknown): Promise<void> {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
    socket.send(`echo:${text.length}:${text.slice(0, 16)}`)
  }

  async closed(socket: ClientSocket): Promise<void> {
    this.closedSockets.add(socket)
  }
}

const recordingLogger = (): { logger: WsLogger; warnings: unknown[] } => {
  const warnings: unknown[] = []
  return {
    warnings,
    logger: {
      info: () => {},
      warn: (payload) => warnings.push(payload),
      error: () => {},
    },
  }
}

const waitUntil = async (condition: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`기다린 조건이 끝내 참이 되지 않았다: ${label}`)
}

const open = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  // 서버가 닫는 쪽의 소켓 오류가 테스트 워커를 죽이지 않게 한다 — 여기서 보는 것은 서버다.
  socket.on('error', () => {})
  return socket
}

const closeCodeOf = (socket: WebSocket): Promise<number> =>
  new Promise((resolve) => socket.once('close', (code) => resolve(code)))

const roundTrip = async (socket: WebSocket, text: string): Promise<string> => {
  const reply = new Promise<string>((resolve) => {
    socket.once('message', (data) => resolve(data.toString()))
  })
  socket.send(text)
  return reply
}

describe('WS 게이트웨이 — 잘못된 프레임은 그 연결만 닫는다', () => {
  let http: Server | undefined
  let gateway: GameSocketGateway | undefined
  const clients: WebSocket[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate()
    await gateway?.close()
    const closing = http
    if (closing) await new Promise<void>((resolve) => closing.close(() => resolve()))
    http = undefined
    gateway = undefined
  })

  const start = async (handler: SocketEventHandler, logger: WsLogger): Promise<string> => {
    const server = createServer()
    http = server
    gateway = attachGameSocketGateway(server, handler, { logger })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo
    return `ws://127.0.0.1:${port}/ws/v1/game`
  }

  const connect = async (url: string): Promise<WebSocket> => {
    const socket = await open(url)
    clients.push(socket)
    return socket
  }

  const hostileFrames = [
    {
      name: '상한을 1바이트 넘긴 메시지',
      closeCode: 1009,
      errorCode: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
      send: (socket: WebSocket) => socket.send('x'.repeat(WS_MAX_MESSAGE_BYTES + 1)),
    },
    {
      name: '깨진 UTF-8 텍스트 프레임',
      closeCode: 1007,
      errorCode: 'WS_ERR_INVALID_UTF8',
      send: (socket: WebSocket) => socket.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false }),
    },
  ]

  it.each(hostileFrames)('$name → 그 연결만 닫히고 서버는 산다', async (frame) => {
    const handler = new EchoHandler()
    const { logger, warnings } = recordingLogger()
    const url = await start(handler, logger)
    const bystander = await connect(url)
    const attacker = await connect(url)
    await waitUntil(() => handler.sockets.length === 2, '두 연결이 핸들러에 닿는다')
    const [bystanderSide, attackerSide] = handler.sockets

    const attackerClosed = closeCodeOf(attacker)
    frame.send(attacker)

    expect(await attackerClosed).toBe(frame.closeCode)
    // 곁에 있던 연결은 끊기지 않았고, 새 연결도 받는다 — 프로세스가 살아 있다.
    expect(await roundTrip(bystander, 'still-here')).toBe('echo:10:still-here')
    const late = await connect(url)
    expect(await roundTrip(late, 'late')).toBe('echo:4:late')
    // 끊긴 연결은 평소의 정리 경로(closed)를 탄다 — 레지스트리·하트비트 정리가 여기 걸려 있다.
    const attackerCleanedUp = (): boolean =>
      attackerSide !== undefined && handler.closedSockets.has(attackerSide)
    await waitUntil(attackerCleanedUp, '끊긴 연결의 closed 호출')
    expect(bystanderSide !== undefined && handler.closedSockets.has(bystanderSide)).toBe(false)
    expect(warnings).toEqual([expect.objectContaining({ code: frame.errorCode })])
  })

  it('정확히 상한 크기인 메시지는 그대로 받는다', async () => {
    const handler = new EchoHandler()
    const { logger, warnings } = recordingLogger()
    const url = await start(handler, logger)
    const client = await connect(url)

    const reply = await roundTrip(client, 'y'.repeat(WS_MAX_MESSAGE_BYTES))

    expect(reply).toBe(`echo:${WS_MAX_MESSAGE_BYTES}:${'y'.repeat(16)}`)
    expect(client.readyState).toBe(WebSocket.OPEN)
    expect(warnings).toEqual([])
  })
})
