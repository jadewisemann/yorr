import type { ClientMessage, ServerMessage } from './wsEvents'

export type MessageListener = (message: ServerMessage) => void
export type ConnectionListener = (event: 'open' | 'close' | 'error') => void

export interface RealtimeClient {
  connect(): void
  disconnect(): void
  send(message: ClientMessage): void
  onMessage(listener: MessageListener): () => void
  onConnectionChange(listener: ConnectionListener): () => void
}

export class WebSocketRealtimeClient implements RealtimeClient {
  private socket: WebSocket | null = null
  private readonly messageListeners = new Set<MessageListener>()
  private readonly connectionListeners = new Set<ConnectionListener>()

  constructor(private readonly endpoint = '/ws/v1/game') {}

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
