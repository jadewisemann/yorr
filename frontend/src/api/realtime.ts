import type { ClientMessage, ServerMessage } from './ws-events'

export type MessageListener = (message: ServerMessage) => void
export type ConnectionListener = (event: 'open' | 'close' | 'error') => void

export interface RealtimeClient {
  connect(): void
  disconnect(): void
  send(message: ClientMessage): void
  onMessage(listener: MessageListener): () => void
  onConnectionChange(listener: ConnectionListener): () => void
}

export class FakeRealtimeClient implements RealtimeClient {
  readonly sentMessages: ClientMessage[] = []
  private readonly messageListeners = new Set<MessageListener>()
  private readonly connectionListeners = new Set<ConnectionListener>()

  connect() {
    this.emitConnection('open')
  }

  disconnect() {
    this.emitConnection('close')
  }

  send(message: ClientMessage) {
    this.sentMessages.push(message)
  }

  onMessage(listener: MessageListener) {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onConnectionChange(listener: ConnectionListener) {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  emitMessage(message: ServerMessage) {
    for (const listener of this.messageListeners) listener(message)
  }

  emitConnection(event: Parameters<ConnectionListener>[0]) {
    for (const listener of this.connectionListeners) listener(event)
  }
}
