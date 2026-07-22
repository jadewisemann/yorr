import type { ClientMessage, ServerMessage } from '../../contracts/ws-events'

export type MessageListener = (message: ServerMessage) => void
export type ConnectionListener = (event: 'open' | 'close' | 'error') => void

export interface RealtimeClient {
  connect(): void
  disconnect(): void
  send(message: ClientMessage): void
  onMessage(listener: MessageListener): () => void
  onConnectionChange(listener: ConnectionListener): () => void
}
