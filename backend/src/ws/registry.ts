import type { PlayerStatus, WsPlayer, WsRoomPhase, WsRoomSnapshot } from './protocol.js'
import type { ClientSocket } from './socket.js'

/**
 * 방 멤버십(누가·어느 방에·어떤 정체성/상태로)의 인메모리 저장소 —
 * backend-java `ws/RoomSessionRegistry`.
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
  /**
   * roomId → 음성 채널에 들어와 있는 playerId. 방 명단(`rooms`)과 **별개 맵**이다 —
   * 방에는 있는데 마이크만 내려놓은 상태가 정상이라 같은 맵에 섞을 수 없다
   * (docs/design/voice.md).
   */
  private readonly voiceMembers = new Map<string, Set<string>>()

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

  of(socket: ClientSocket): RoomMember | null {
    return this.bySocket.get(socket) ?? null
  }

  /** 대기실에서의 소켓 종료·명시 퇴장. @returns 빠진 멤버(원래 없었으면 null). */
  remove(socket: ClientSocket): RoomMember | null {
    const member = this.bySocket.get(socket)
    if (!member) return null
    this.bySocket.delete(socket)
    const members = this.rooms.get(member.roomId)
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
    const member = this.bySocket.get(socket)
    if (!member) return null
    this.bySocket.delete(socket)
    const members = this.rooms.get(member.roomId)
    if (!members || members.get(member.playerId) !== member) return null
    const offline: RoomMember = { ...member, status: 'offline', socket: null }
    members.set(member.playerId, offline)
    return offline
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

  /* ------------------------------------------------------------ 음성 채널 명단 */

  /*
   * 아래 두 메서드는 갱신 후 **전체 명단**을 돌려준다 — `voice.peers`가 증분이 아니라
   * 전체 스냅샷이라 호출부가 받은 값을 그대로 브로드캐스트할 수 있다.
   */

  /** 음성 채널 입장(멱등). 재연결 직후의 중복 `voice.join`이 명단을 망가뜨리면 안 된다. */
  joinVoice(roomId: string, playerId: string): string[] {
    let members = this.voiceMembers.get(roomId)
    if (!members) {
      members = new Set()
      this.voiceMembers.set(roomId, members)
    }
    members.add(playerId)
    return [...members]
  }

  /**
   * 음성 채널 퇴장. `voice.leave`·소켓 종료·방 퇴장이 모두 이리로 온다 —
   * `voice.leave`를 못 보내고 끊기는 것이 정상 경로라 어느 쪽에서 불러도 안전해야 한다.
   */
  leaveVoice(roomId: string, playerId: string): string[] {
    const members = this.voiceMembers.get(roomId)
    if (!members) return []
    members.delete(playerId)
    // 빈 Set을 남기면 방이 사라진 뒤에도 키가 쌓인다.
    if (members.size === 0) {
      this.voiceMembers.delete(roomId)
      return []
    }
    return [...members]
  }

  /** 지금 음성 채널에 있는 사람들. 통화 중이 아무도 없으면 빈 목록. */
  voiceMembersOf(roomId: string): string[] {
    const members = this.voiceMembers.get(roomId)
    return members ? [...members] : []
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

  /**
   * 방이 비면 phase·gameCode·음성 명단도 함께 버린다 — 방 코드는 재사용되기 때문이다
   * (이전 통화 명단이 남으면 새 방이 통화 중으로 보인다).
   */
  private forgetRoom(roomId: string): void {
    this.rooms.delete(roomId)
    this.gameCodes.delete(roomId)
    this.phases.delete(roomId)
    this.voiceMembers.delete(roomId)
  }
}
