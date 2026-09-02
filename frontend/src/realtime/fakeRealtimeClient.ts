import { type ConnectionListener, type RealtimeClient, RealtimeListenerHub } from './realtimeClient'
import type { ClientMessage, ClientMessageType, ServerMessage } from './wsEvents'

type FakeMessageHandler<T extends ClientMessageType = ClientMessageType> = (
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

export class FakeRealtimeClient extends RealtimeListenerHub implements RealtimeClient {
  readonly sentMessages: ClientMessage[] = []
  private readonly options: FakeRealtimeOptions

  constructor(options: FakeRealtimeOptions = {}) {
    super()
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

  /**
   * 검사가 서버 대신 밀어 넣는 구멍. 기반에서는 보호된 자리지만, 대역에서는 이것이
   * 곧 쓰임새라 밖으로 연다.
   */
  override emitMessage(message: ServerMessage) {
    super.emitMessage(message)
  }

  override emitConnection(event: Parameters<ConnectionListener>[0]) {
    super.emitConnection(event)
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
