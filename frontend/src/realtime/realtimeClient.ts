import type { ClientMessage, ServerMessage } from './wsEvents'

export type MessageListener = (message: ServerMessage) => void
export type ConnectionListener = (event: 'open' | 'close' | 'error') => void

export interface RealtimeClient {
  connect(): void
  disconnect(): void
  send(message: ClientMessage): void
  /**
   * 서버를 거치지 않고 도착한 메시지를 **서버에서 온 것과 같은 팬아웃**에 흘린다.
   * 컨트롤러 링크(`controllerLink/`)가 피어에게서 직접 받은 연출 릴레이를 여기로 넣기
   * 때문에, 소비자(`useRollIncoming` 등)는 어느 전송을 타고 왔는지 알 필요가 없다.
   *
   * 전송 계층에 남기는 유일한 주입 구멍이라 이름에 `local`을 박아 뒀다 — 서버에 나가는
   * 것은 `send`뿐이다.
   */
  deliverLocal(message: ServerMessage): void
  onMessage(listener: MessageListener): () => void
  onConnectionChange(listener: ConnectionListener): () => void
}

export class WebSocketRealtimeClient implements RealtimeClient {
  private socket: WebSocket | null = null
  private readonly messageListeners = new Set<MessageListener>()
  private readonly connectionListeners = new Set<ConnectionListener>()

  constructor(private readonly endpoint = import.meta.env.VITE_WS_URL ?? '/ws/v1/game') {}

  connect() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return

    this.socket = new WebSocket(resolveWebSocketUrl(this.endpoint))
    this.socket.addEventListener('open', () => this.emitConnection('open'))
    this.socket.addEventListener('close', () => this.emitConnection('close'))
    this.socket.addEventListener('error', () => this.emitConnection('error'))
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        this.emitConnection('error')
        return
      }

      try {
        this.emitMessage(JSON.parse(event.data) as ServerMessage)
      } catch {
        this.emitConnection('error')
      }
    })
  }

  disconnect() {
    this.socket?.close()
    this.socket = null
  }

  send(message: ClientMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected')
    }
    this.socket.send(JSON.stringify(message))
  }

  deliverLocal(message: ServerMessage) {
    this.emitMessage(message)
  }

  onMessage(listener: MessageListener) {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onConnectionChange(listener: ConnectionListener) {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  private emitMessage(message: ServerMessage) {
    for (const listener of this.messageListeners) listener(message)
  }

  private emitConnection(event: Parameters<ConnectionListener>[0]) {
    for (const listener of this.connectionListeners) listener(event)
  }
}

function resolveWebSocketUrl(endpoint: string) {
  if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) return endpoint

  const url = new URL(endpoint, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
