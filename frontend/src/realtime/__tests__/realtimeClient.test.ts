import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketRealtimeClient } from '@/realtime/realtimeClient'
import { buildClientMessage, type ServerMessage } from '@/realtime/wsEvents'

/**
 * 전역 WebSocket 대역. 실제 소켓 없이 open/close/error/message 프레임을
 * 테스트가 직접 밀어 넣어 클라이언트의 계약(파싱·에러 승격·생명주기)만 검증한다.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState: number = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  closeCount = 0
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const bucket = this.listeners.get(type) ?? new Set()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCount += 1
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', {})
  }

  /* ----- 테스트 조작용 ----- */

  acceptConnection() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open', {})
  }

  failConnection() {
    this.emit('error', {})
  }

  receive(data: unknown) {
    this.emit('message', { data })
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function lastSocket() {
  const socket = FakeWebSocket.instances.at(-1)
  if (!socket) throw new Error('소켓이 열리지 않았습니다.')
  return socket
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WebSocket endpoint 해석', () => {
  it('상대 경로는 현재 페이지 기준 ws:// 절대 URL로 승격한다', () => {
    new WebSocketRealtimeClient('/ws/v1/game').connect()

    expect(lastSocket().url).toBe(`ws://${window.location.host}/ws/v1/game`)
  })

  it('기본 endpoint로도 연결할 수 있다', () => {
    new WebSocketRealtimeClient().connect()

    expect(lastSocket().url.startsWith('ws')).toBe(true)
  })

  it('이미 ws://·wss://인 endpoint는 그대로 쓴다', () => {
    new WebSocketRealtimeClient('ws://relay.local/game').connect()
    expect(lastSocket().url).toBe('ws://relay.local/game')

    new WebSocketRealtimeClient('wss://relay.local/game').connect()
    expect(lastSocket().url).toBe('wss://relay.local/game')
  })

  it('https endpoint는 wss로 승격한다 — 혼합 콘텐츠로 차단되지 않게', () => {
    new WebSocketRealtimeClient('https://yorr.app/ws/v1/game').connect()

    expect(lastSocket().url).toBe('wss://yorr.app/ws/v1/game')
  })
})

describe('연결 생명주기', () => {
  it('살아 있는 소켓이 있으면 connect를 다시 불러도 새로 열지 않는다', () => {
    const client = new WebSocketRealtimeClient('/ws')

    client.connect()
    client.connect()

    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('닫힌 소켓 위에서는 connect가 새 소켓을 연다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    client.connect()
    lastSocket().readyState = FakeWebSocket.CLOSED

    client.connect()

    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('open·close·error를 연결 리스너에 그대로 전달한다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    const events: string[] = []
    client.onConnectionChange((event) => events.push(event))

    client.connect()
    const socket = lastSocket()
    socket.acceptConnection()
    socket.failConnection()
    socket.close()

    expect(events).toEqual(['open', 'error', 'close'])
  })

  it('disconnect는 소켓을 닫고 참조를 버린다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    client.connect()
    const socket = lastSocket()
    socket.acceptConnection()

    client.disconnect()

    expect(socket.closeCount).toBe(1)
    // 참조를 버렸으니 다음 connect는 새 소켓을 연다.
    client.connect()
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('연결 전 disconnect는 아무 일도 하지 않는다', () => {
    expect(() => new WebSocketRealtimeClient('/ws').disconnect()).not.toThrow()
  })
})

describe('메시지 수신', () => {
  const joined: ServerMessage = {
    type: 'sys.pong',
    ts: 1_753_000_000_000,
    payload: { serverTs: 1_753_000_000_000 },
  }

  it('문자열 프레임을 JSON으로 파싱해 메시지 리스너에 넘긴다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    const messages: ServerMessage[] = []
    client.onMessage((message) => messages.push(message))

    client.connect()
    lastSocket().receive(JSON.stringify(joined))

    expect(messages).toEqual([joined])
  })

  it('JSON으로 읽을 수 없는 프레임은 error 연결 이벤트로 올린다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    const messages: ServerMessage[] = []
    const events: string[] = []
    client.onMessage((message) => messages.push(message))
    client.onConnectionChange((event) => events.push(event))

    client.connect()
    lastSocket().receive('{not json')

    expect(messages).toEqual([])
    expect(events).toEqual(['error'])
  })

  it('binary 프레임은 메시지로 올리지 않고 error로 처리한다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    const messages: ServerMessage[] = []
    const events: string[] = []
    client.onMessage((message) => messages.push(message))
    client.onConnectionChange((event) => events.push(event))

    client.connect()
    lastSocket().receive(new ArrayBuffer(4))

    expect(messages).toEqual([])
    expect(events).toEqual(['error'])
  })

  it('구독 해지 함수는 리스너를 실제로 떼어낸다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    const messages: ServerMessage[] = []
    const events: string[] = []
    const unsubscribeMessage = client.onMessage((message) => messages.push(message))
    const unsubscribeConnection = client.onConnectionChange((event) => events.push(event))

    client.connect()
    unsubscribeMessage()
    unsubscribeConnection()
    const socket = lastSocket()
    socket.acceptConnection()
    socket.receive(JSON.stringify(joined))

    expect(messages).toEqual([])
    expect(events).toEqual([])
  })
})

describe('메시지 송신', () => {
  it('열린 소켓에만 JSON 문자열로 보낸다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    client.connect()
    const socket = lastSocket()
    socket.acceptConnection()

    const message = buildClientMessage('sys.ping', { clientTs: 1 })
    client.send(message)

    expect(socket.sent).toEqual([JSON.stringify(message)])
  })

  it('연결 전이나 닫힌 뒤 send는 조용히 삼키지 않고 예외로 알린다', () => {
    const client = new WebSocketRealtimeClient('/ws')
    const message = buildClientMessage('sys.ping', { clientTs: 1 })

    expect(() => client.send(message)).toThrow('WebSocket is not connected')

    client.connect()
    // 아직 CONNECTING 상태라 보낼 수 없다.
    expect(() => client.send(message)).toThrow('WebSocket is not connected')

    lastSocket().acceptConnection()
    client.disconnect()
    expect(() => client.send(message)).toThrow('WebSocket is not connected')
  })
})
