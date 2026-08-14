import type { RoomService } from '../room/roomService.js'
import { type PlayerStatus, toWsPhase, type WsPlayer, type WsRoomSnapshot } from './protocol.js'
import type { RoomSessionRegistry } from './registry.js'

/**
 * Redis의 전체 참가자 명단과 WebSocket의 접속 상태를 합쳐 클라이언트용 스냅샷을
 * 만든다 — backend-java `ws/RealtimeRoomSnapshotService`.
 *
 * 봇은 서버가 제어하는 참가자라 소켓 레지스트리에 없다 → **항상 online**.
 * Redis에는 있는데 소켓이 없는 사람은 offline이다.
 */
export class RealtimeRoomSnapshotService {
  constructor(
    private readonly rooms: RoomService,
    private readonly sessions: RoomSessionRegistry,
  ) {}

  async snapshot(roomId: string): Promise<WsRoomSnapshot> {
    const persistent = await this.rooms.getSnapshot(roomId)
    // 방이 이미 사라졌으면 인메모리 명단만으로 답한다(Java와 같음).
    if (persistent.phase === null) return this.sessions.snapshot(roomId)

    const players = persistent.players
      .map<WsPlayer>((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        status: this.statusOf(roomId, player.playerId, player.kind === 'BOT'),
        isHost: player.playerId === persistent.hostId,
        kind: player.kind,
      }))
      .sort((left, right) => (left.playerId < right.playerId ? -1 : 1))

    return {
      roomId,
      gameCode: persistent.gameCode ?? undefined,
      phase: toWsPhase(persistent.phase),
      hostId: persistent.hostId ?? undefined,
      players,
      capacity: persistent.capacity,
    }
  }

  private statusOf(roomId: string, playerId: string, bot: boolean): PlayerStatus {
    if (bot) return 'online'
    return this.sessions.find(roomId, playerId)?.status ?? 'offline'
  }
}
