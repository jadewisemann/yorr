import type { PlayerStatus, WsPlayer, WsRoomPhase, WsRoomSnapshot } from './protocol.js'
import type { ClientSocket } from './socket.js'

/**
 * 방 멤버십(누가·어느 방에·어떤 정체성/상태로)의 인메모리 저장소.
 *
 * 역할 분담: "봉투를 방 전원에게 쏘는 팬아웃"은 `RoomBroadcaster`, "그 방에 지금
 * 누가 있는지"는 여기다. 둘 다 인메모리이고 **상태의 권위는 Redis**에 있다
 * (docs/design/realtime.md 「구독·브로드캐스트 모델」).
 */
export interface RoomMember {
  readonly playerId: string
  readonly roomId: string
  readonly nickname: string
  readonly host: boolean
  readonly status: PlayerStatus
  /** 오프라인 좌석은 소켓이 없다 — 자리는 남기고 연결만 없는 상태. */
  readonly socket: ClientSocket | null
}

export const toWsPlayer = (member: RoomMember): WsPlayer => ({
  playerId: member.playerId,
  nickname: member.nickname,
  status: member.status,
  isHost: member.host,
  kind: 'HUMAN',
})

export class RoomSessionRegistry {
  // roomId → (playerId → Member)
  private readonly rooms = new Map<string, Map<string, RoomMember>>()
  // socket → Member : 소켓이 끊길 때 "소켓만으로" 누구였는지 역추적한다.
  private readonly bySocket = new Map<ClientSocket, RoomMember>()
  private readonly phases = new Map<string, WsRoomPhase>()
  private readonly gameCodes = new Map<string, string>()
  /** 방에 적힌 게임을 기록한다. 같은 방에 다른 게임이 들어오면 상태가 섞이므로 던진다. */
  registerGame(roomId: string, gameCode: string | null | undefined): void {
    if (!gameCode || gameCode.trim().length === 0) throw new Error('invalid_game_code')
    const current = this.gameCodes.get(roomId)
    if (current !== undefined && current !== gameCode) throw new Error('room_game_mismatch')
    this.gameCodes.set(roomId, gameCode)
  }

  /**
   * 방 입장. 그 방의 첫 입장자가 host가 되고, **같은 playerId의 재입장은 자리와
   * host를 유지한 채 소켓만 교체**한다(재접속 경로).
   */
  join(roomId: string, socket: ClientSocket, playerId: string, nickname: string): RoomMember {
    let members = this.rooms.get(roomId)
    if (!members) {
      members = new Map()
      this.rooms.set(roomId, members)
    }
    const existing = members.get(playerId)
    const member: RoomMember = {
      playerId,
      roomId,
      nickname,
      host: existing ? existing.host : members.size === 0,
      status: 'online',
      socket,
    }
    members.set(playerId, member)
    if (existing?.socket && this.bySocket.get(existing.socket) === existing) {
      this.bySocket.delete(existing.socket)
    }
    this.bySocket.set(socket, member)
    return member
  }

  /** 방 안에서 이 playerId가 차지한 자리. 재접속·중복 세션 판정에 쓴다. */
  find(roomId: string, playerId: string): RoomMember | null {
    return this.rooms.get(roomId)?.get(playerId) ?? null
  }

  /**
   * 그 방의 좌석 전부(오프라인 좌석·파티 대시보드 포함).
   *
   * 방송이 아니라 **좌석마다 다른 내용을 보내야 하는** 게임이 쓴다(다빈치 코드의
   * `DavinciAudience`). 방 스냅샷의 플레이어 명단으로는 대신할 수 없다 — 대시보드는
   * 명단에 없지만 화면을 받아야 하기 때문이다.
   */
  membersOf(roomId: string): RoomMember[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])]
  }

  of(socket: ClientSocket): RoomMember | null {
    return this.bySocket.get(socket) ?? null
  }

  /** 대기실에서의 소켓 종료·명시 퇴장. @returns 빠진 멤버(원래 없었으면 null). */
  remove(socket: ClientSocket): RoomMember | null {
    const detached = this.detach(socket)
    if (!detached) return null
    const { member, members } = detached
    if (members) {
      members.delete(member.playerId)
      if (members.size === 0) this.forgetRoom(member.roomId)
    }
    return member
  }

  /**
   * 게임 중 비명시 종료를 명단 이탈이 아닌 offline 전이로 기록한다.
   * 이미 새 소켓으로 교체된 뒤 옛 소켓의 close가 도착하면 현재 멤버를 건드리지 않는다.
   */
  markOffline(socket: ClientSocket): RoomMember | null {
    const detached = this.detach(socket)
    if (!detached) return null
    const { member, members } = detached
    if (!members || members.get(member.playerId) !== member) return null
    const offline: RoomMember = { ...member, status: 'offline', socket: null }
    members.set(member.playerId, offline)
    return offline
  }

  /**
   * 소켓 매핑을 끊고, 그 멤버와 방 명단을 함께 돌려준다. 끊는 것까지가 두 종료 경로의
   * 공통이고, 명단을 어떻게 할지가 갈리는 자리다.
   */
  private detach(
    socket: ClientSocket,
  ): { member: RoomMember; members: Map<string, RoomMember> | undefined } | null {
    const member = this.bySocket.get(socket)
    if (!member) return null
    this.bySocket.delete(socket)
    return { member, members: this.rooms.get(member.roomId) }
  }

  /**
   * playerId로 좌석을 뺀다. 오프라인 멤버는 소켓이 없어 {@link remove}로 지울 수
   * 없으므로 게임 중 이탈(명시 퇴장·오프라인 자동 퇴장)은 이 경로를 쓴다.
   */
  removePlayer(roomId: string, playerId: string): RoomMember | null {
    const members = this.rooms.get(roomId)
    const member = members?.get(playerId)
    if (!members || !member) return null
    members.delete(playerId)
    if (member.socket && this.bySocket.get(member.socket) === member) {
      this.bySocket.delete(member.socket)
    }
    if (members.size === 0) this.forgetRoom(roomId)
    return member
  }

  /** 게임 시작처럼 **REST가 상태를 바꾸는** 경로에서 알려 준다. 기본은 `waiting`. */
  markPhase(roomId: string, phase: WsRoomPhase): void {
    this.phases.set(roomId, phase)
  }

  phaseOf(roomId: string): WsRoomPhase {
    return this.phases.get(roomId) ?? 'waiting'
  }

  gameCodeOf(roomId: string): string | null {
    return this.gameCodes.get(roomId) ?? null
  }

  /** 현재 게임을 진행 중인 방의 수(`yorr_rooms_active`). */
  activeRoomCount(): number {
    let count = 0
    for (const phase of this.phases.values()) if (phase === 'playing') count += 1
    return count
  }

  /** 그 게임을 플레이 중이며 소켓이 살아 있는 참가자 수(`yorr_game_participants_active`). */
  activeParticipantCount(gameCode: string | null | undefined): number {
    if (!gameCode || gameCode.trim().length === 0) return 0
    const wanted = gameCode.toUpperCase()
    const players = new Set<string>()
    for (const member of this.bySocket.values()) {
      if (this.phaseOf(member.roomId) !== 'playing') continue
      if (this.gameCodeOf(member.roomId)?.toUpperCase() !== wanted) continue
      players.add(member.playerId)
    }
    return players.size
  }

  /**
   * 인메모리 명단만으로 만드는 스냅샷. 게임 진행 상태(`game`)와 Redis 참가자(봇 포함)는
   * 모르므로 실시간 병합은 `RealtimeRoomSnapshotService`가 한다.
   */
  snapshot(roomId: string): WsRoomSnapshot {
    const members = this.rooms.get(roomId)
    const players: WsPlayer[] = []
    let hostId: string | undefined
    if (members) {
      for (const member of members.values()) {
        players.push(toWsPlayer(member))
        if (member.host) hostId = member.playerId
      }
    }
    return {
      roomId,
      gameCode: this.gameCodes.get(roomId),
      phase: this.phaseOf(roomId),
      hostId,
      players,
    }
  }

  /** 방이 비면 phase·gameCode도 함께 버린다 — 방 코드는 재사용되기 때문이다. */
  private forgetRoom(roomId: string): void {
    this.rooms.delete(roomId)
    this.gameCodes.delete(roomId)
    this.phases.delete(roomId)
  }
}
