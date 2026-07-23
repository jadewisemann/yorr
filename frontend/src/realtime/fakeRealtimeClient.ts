import type { ConnectionListener, MessageListener, RealtimeClient } from './realtimeClient'
import type { ClientMessage, ClientMessageType, ServerMessage } from './wsEvents'

export type FakeMessageHandler<T extends ClientMessageType = ClientMessageType> = (
  message: Extract<ClientMessage, { type: T }>,
) => ServerMessage[]

export type FakeMessageHandlers = {
  [T in ClientMessageType]?: FakeMessageHandler<T>
}

export interface FakeRealtimeOptions {
  connectionMessages?: ServerMessage[]
  handlers?: FakeMessageHandlers
  delayMs?: number
  strict?: boolean
}

export class FakeRealtimeClient implements RealtimeClient {
  readonly sentMessages: ClientMessage[] = []
  private readonly messageListeners = new Set<MessageListener>()
  private readonly connectionListeners = new Set<ConnectionListener>()
  private readonly options: FakeRealtimeOptions

  constructor(options: FakeRealtimeOptions = {}) {
    this.options = options
  }

  connect() {
    this.emitConnection('open')
    this.emitMessages(this.options.connectionMessages ?? [])
  }

  disconnect() {
    this.emitConnection('close')
  }

  send(message: ClientMessage) {
    this.sentMessages.push(message)
    const handler = this.options.handlers?.[message.type] as
      | FakeMessageHandler<typeof message.type>
      | undefined

    if (!handler) {
      if (this.options.strict) throw new Error(`Unhandled fake realtime event: ${message.type}`)
      return
    }

    this.emitMessages(handler(message))
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

  private emitMessages(messages: ServerMessage[]) {
    const emit = () => {
      for (const message of messages) this.emitMessage(message)
    }

    if ((this.options.delayMs ?? 0) > 0) {
      globalThis.setTimeout(emit, this.options.delayMs)
      return
    }

    emit()
  }
}
