import type { ClientMessage, ServerMessage } from '../../contracts/ws-events'
import type { ConnectionListener, MessageListener, RealtimeClient } from './RealtimeClient'

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
