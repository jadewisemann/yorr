import type { OutboundEnvelope } from './envelope.js'
import { type ClientSocket, isOpen } from './socket.js'

/**
 * 방별 소켓 집합(팬아웃).
 *
 * 레지스트리와 **별개 맵**이다: 명단에는 올랐지만 아직 팬아웃에 없는 순간이
 * `room.join`의 순서 계약(본인이 자기 입장 소식을 받지 않는다)을 만든다.
 */
export class RoomBroadcaster {
  private readonly rooms = new Map<string, Set<ClientSocket>>()
  /** 소켓 → 등록된 방. */
  private readonly roomOf = new Map<ClientSocket, string>()

  register(roomId: string, socket: ClientSocket): void {
    this.unregister(socket)
    let sockets = this.rooms.get(roomId)
    if (!sockets) {
      sockets = new Set()
      this.rooms.set(roomId, sockets)
    }
    sockets.add(socket)
    this.roomOf.set(socket, roomId)
  }

  unregister(socket: ClientSocket): void {
    const roomId = this.roomOf.get(socket)
    if (roomId === undefined) return
    this.roomOf.delete(socket)
    const sockets = this.rooms.get(roomId)
    if (!sockets) return
    sockets.delete(socket)
    if (sockets.size === 0) this.rooms.delete(roomId)
  }

  /**
   * **한 번 직렬화해 같은 프레임을 전 소켓에 재사용**한다. 닫힌 소켓은 건너뛰고
   * 개별 전송 실패는 삼킨다 — 죽은 소켓 하나가 방송 전체를 막지 않는다.
   * 실제 제거는 소켓 close 경로(`unregister`)의 몫이다.
   */
  broadcast(roomId: string, message: OutboundEnvelope): void {
    const sockets = this.rooms.get(roomId)
    if (!sockets || sockets.size === 0) return
    const frame = JSON.stringify(message)
    for (const socket of sockets) {
      if (!isOpen(socket)) continue
      try {
        socket.send(frame)
      } catch {
        // 개별 소켓 실패는 무시한다 — 하나가 죽어도 나머지 팬아웃은 나가야 한다.
      }
    }
  }

  size(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0
  }
}
