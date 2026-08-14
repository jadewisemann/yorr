import type { WebSocket } from 'ws'
import type { OutboundEnvelope } from './envelope.js'

// 연결 관리는 인메모리 — 방 멤버십·점수·phase의 권위는 Redis에 있고(docs/design/realtime.md),
// 이 레지스트리는 "지금 이 프로세스에 붙어 있는 소켓"만 안다.
export class RoomSocketRegistry {
  private readonly rooms = new Map<string, Set<WebSocket>>()

  subscribe(roomId: string, socket: WebSocket): void {
    let sockets = this.rooms.get(roomId)
    if (!sockets) {
      sockets = new Set()
      this.rooms.set(roomId, sockets)
    }
    sockets.add(socket)
  }

  unsubscribe(roomId: string, socket: WebSocket): void {
    const sockets = this.rooms.get(roomId)
    if (!sockets) return
    sockets.delete(socket)
    if (sockets.size === 0) this.rooms.delete(roomId)
  }

  unsubscribeAll(socket: WebSocket): void {
    for (const roomId of this.rooms.keys()) {
      this.unsubscribe(roomId, socket)
    }
  }

  broadcast(roomId: string, message: OutboundEnvelope): void {
    const sockets = this.rooms.get(roomId)
    if (!sockets) return
    const data = JSON.stringify(message)
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(data)
    }
  }

  size(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0
  }
}
